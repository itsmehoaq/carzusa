const axios = require("axios");
const { spawn, execFile } = require("node:child_process");
const { createHash } = require("node:crypto");
const path = require("node:path");
const adapter = require("../sourceDataAdapter");

// The original bot linked this engine but did not pin its historical version.
const ENGINE_VERSION = "reference-f7651f3/pyttanko-2.1.0-6e01fb63aee804c88ba29c2af206800aea5232b4";
const FAILURE_MESSAGE = "The osu! performance calculator is unavailable. Please try again later.";
const MAX_RAW = 4 * 1024 * 1024;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const MODS = new Set("NF EZ TD HD HR SD DT RX HT NC FL Auto SO AP PF 4K 5K 6K 7K 8K FI RDM CI TG 9K 10K 1K 3K 2K V2 MI".toUpperCase().split(" "));

function modeNumber(mode) {
  const result = adapter.modeNumber(mode);
  if (!Number.isInteger(result) || result < 0 || result > 3) throw new Error("Unsupported osu! ruleset.");
  return result;
}

function mapInputs(map, mode = map.mode_int ?? map.mode ?? 0) {
  const data = { ...adapter.mapData(map), mode: modeNumber(mode) };
  // Preserve explicitly supplied legacy values, including null and zero.
  if (own(map, "od")) data.od = map.od;
  if (own(map, "hp")) data.hp = map.hp;
  if (own(map, "beatmap_id")) data.beatmap_id = map.beatmap_id;
  delete data.sourceCalculation;
  return data;
}

function scoreInputs(score, mode) {
  const stats = score.statistics || {};
  mode = modeNumber(mode ?? score.ruleset_id ?? score.mode_int ?? score.mode ?? 0);
  const read = (legacy, modern, fallback = 0) => own(score, legacy) ? score[legacy]
    : own(stats, legacy) ? stats[legacy] : own(stats, modern) ? stats[modern] : fallback;
  const play = {
    count_300: read("count_300", "great"), count_100: read("count_100", mode === 2 ? "large_tick_hit" : "ok"),
    count_50: read("count_50", mode === 2 ? "small_tick_hit" : "meh"), count_miss: read("count_miss", "miss"),
    count_geki: read("count_geki", mode === 3 ? "perfect" : "count_geki"),
    count_katu: read("count_katu", mode === 2 ? "small_tick_miss" : mode === 3 ? "good" : "count_katu"),
    max_combo: score.max_combo, rank: score.failed || score.passed === false ? "F" : score.rank,
  };
  if (mode === 2 && !own(score, "count_miss") && !own(stats, "count_miss")) {
    play.count_miss = Number(play.count_miss) + Number(stats.large_tick_miss ?? 0);
  }
  // Taiko has no 50 judgments; standard slider ticks never enter legacy counts.
  if (mode === 1) play.count_50 = read("count_50", "count_50");
  const scoreKeys = mode === 3 ? ["score", "legacy_total_score", "total_score"]
    : ["score", "total_score", "legacy_total_score"];
  for (const key of scoreKeys) {
    if (own(score, key)) { play.score = score[key]; break; }
  }
  return play;
}

function modInputs(score = {}) {
  const raw = score.raw_mods ?? score.mods ?? [];
  if (Array.isArray(raw)) {
    for (const mod of raw) {
      if (mod && typeof mod === "object" && mod.settings && Object.keys(mod.settings).length) {
        throw new Error("Modern osu! mod settings are unsupported by the source calculator.");
      }
      const acronym = typeof mod === "string" ? mod : mod?.acronym;
      if (!MODS.has(String(acronym).toUpperCase()) && acronym !== "NM") throw new Error("Unsupported osu! mod.");
    }
  }
  if (score.enabled_mods != null) return Number(score.enabled_mods);
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    if (/^\d+$/.test(raw)) return Number(raw);
    if (raw === "NM" || raw === "") return 0;
    const tokens = raw.toUpperCase().match(/10K|AUTO|RDM|[1-9]K|[A-Z0-9]{2}/g) || [];
    if (tokens.join("") !== raw.toUpperCase() || tokens.some(mod => !MODS.has(mod))) throw new Error("Unsupported osu! mod.");
    return raw;
  }
  return raw.map(mod => typeof mod === "string" ? mod : mod.acronym).filter(mod => mod !== "NM").join("");
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const hash = value => createHash("sha256").update(value).digest("hex");

class Lru {
  constructor(maxBytes, maxEntries) { this.maxBytes = maxBytes; this.maxEntries = maxEntries; this.bytes = 0; this.entries = new Map(); }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  delete(key) {
    const entry = this.entries.get(key);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key); }
  }
  set(key, value, bytes) {
    const old = this.entries.get(key);
    if (old) { this.bytes -= old.bytes; this.entries.delete(key); }
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes }); this.bytes += bytes;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const first = this.entries.keys().next().value;
      this.bytes -= this.entries.get(first).bytes; this.entries.delete(first);
    }
  }
}

async function downloadRaw(id) {
  const { data } = await axios.get(`https://osu.ppy.sh/osu/${id}`, {
    timeout: 10_000, signal: AbortSignal.timeout(10_000), responseType: "arraybuffer",
    maxContentLength: MAX_RAW, maxBodyLength: MAX_RAW, maxRedirects: 0,
  });
  return Buffer.from(data);
}

function runWorker(request, { spawnProcess = spawn, timeoutMs = 15_000, outputLimit = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess("/usr/bin/python3", ["-B", path.join(__dirname, "performance/worker.py")], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = [], stderr = [], size = 0, errorSize = 0, finished = false, failure;
    let memoryMonitor, checkingMemory = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      clearInterval(memoryMonitor);
      if (error) reject(error); else resolve(value);
    };
    const abort = error => {
      if (finished || failure) return;
      failure = error;
      child.kill("SIGKILL");
      // Wait for close before releasing the queue's sole worker slot.
    };
    const timer = setTimeout(() => abort(new Error("Performance worker timed out")), timeoutMs);
    // Darwin rejects address-space rlimits. Monitor RSS without overlapping probes.
    if (process.platform === "darwin" && child.pid) {
      memoryMonitor = setInterval(() => {
        if (checkingMemory || finished || failure) return;
        checkingMemory = true;
        execFile("/bin/ps", ["-o", "rss=", "-p", String(child.pid)], { timeout: 1000, maxBuffer: 1024 }, (error, output) => {
          checkingMemory = false;
          if (finished || failure) return;
          if (error) return abort(new Error("Performance memory monitoring failed"));
          const rssKiB = Number(output.trim());
          if (!Number.isFinite(rssKiB) || rssKiB <= 0) return abort(new Error("Invalid performance memory usage"));
          if (rssKiB > 256 * 1024) abort(new Error("Performance memory limit exceeded"));
        });
      }, 100);
    }
    child.on("error", abort);
    child.stdin.on("error", abort);
    child.stdout.on("data", chunk => {
      if (failure) return;
      size += chunk.length;
      if (size > outputLimit) return abort(new Error("Performance output limit exceeded"));
      stdout.push(chunk);
    });
    child.stderr.on("data", chunk => {
      if (failure) return;
      errorSize += chunk.length;
      if (errorSize > outputLimit) return abort(new Error("Performance error output limit exceeded"));
      stderr.push(chunk);
    });
    child.on("close", code => {
      if (finished) return;
      if (failure) return finish(failure);
      if (code !== 0) return finish(new Error(`Performance worker failed: ${Buffer.concat(stderr).toString().slice(0, 400)}`));
      try { finish(null, JSON.parse(Buffer.concat(stdout).toString())); } catch (error) { finish(error); }
    });
    try { child.stdin.end(JSON.stringify(request)); } catch (error) { abort(error); }
  });
}

function createPerformanceCalculator({ fetchRaw = downloadRaw, worker = runWorker, queueLimit = 32,
  rawCacheBytes = 64 * 1024 * 1024, calculationCacheBytes = 16 * 1024 * 1024,
  now = Date.now } = {}) {
  const rawCache = new Lru(rawCacheBytes, 1024);
  const calculations = new Lru(calculationCacheBytes, 256);
  const flights = new Map();
  const queue = [];
  let active = false;
  async function drain() {
    if (active || !queue.length) return;
    active = true;
    const { work, resolve, reject } = queue.shift();
    try { resolve(await work()); } catch (error) { reject(error); }
    finally { active = false; void drain(); }
  }
  async function calculate(map, { score, mode, mods, accs = [95, 99, 100], beatmapMod } = {}) {
    try {
      const metadata = mapInputs(map, mode ?? score?.ruleset_id ?? score?.mode_int ?? score?.mode ?? map.mode_int ?? map.mode ?? 0);
      const id = String(metadata.beatmap_id);
      if (!/^[1-9]\d{0,14}$/.test(id)) throw new Error("Invalid beatmap ID");
      const request = { map: metadata, mods: modInputs(mods === undefined ? score : { mods }), accs, extra: {} };
      if (score) request.extra.play_info = scoreInputs(score, metadata.mode);
      if (beatmapMod !== undefined) request.extra.beatmap_mod = mapInputs(beatmapMod, metadata.mode);
      const flightKey = hash(stable(request));
      if (flights.has(flightKey)) return structuredClone(await flights.get(flightKey));
      if (queue.length >= queueLimit) throw new Error("Performance queue is full");
      const pending = new Promise((resolve, reject) => {
        queue.push({ resolve, reject, work: async () => {
          let raw = rawCache.get(id);
          if (!raw || now() - raw.createdAt > 3600_000) {
            const bytes = Buffer.from(await fetchRaw(id));
            if (!bytes.length || bytes.length > MAX_RAW) throw new Error("Invalid beatmap size");
            raw = { text: bytes.toString("utf8"), checksum: hash(bytes), createdAt: now() };
            rawCache.set(id, raw, bytes.length);
          }
          const key = hash(`${ENGINE_VERSION}:${raw.checksum}:${flightKey}`);
          const cached = calculations.get(key);
          if (cached) return cached;
          let result;
          try {
            result = await worker({ ...request, raw: raw.text });
            const expectedLength = [1, 2].includes(metadata.mode) ? 3 : accs.length;
            if (!Array.isArray(result?.pp_mod) || result.pp_mod.length !== expectedLength) throw new Error("Invalid calculation result");
            if (score && !Number.isFinite(result.extra_info?.play_pp)) throw new Error("Missing play calculation");
          } catch (error) {
            // A transient HTML/error response must not poison retries for an hour.
            rawCache.delete(id);
            throw error;
          }
          const encoded = JSON.stringify(result);
          calculations.set(key, result, Buffer.byteLength(encoded));
          return result;
        } });
      });
      flights.set(flightKey, pending);
      void drain();
      try { return structuredClone(await pending); } finally { flights.delete(flightKey); }
    } catch (cause) {
      throw new Error(FAILURE_MESSAGE, { cause });
    }
  }
  return { calculate };
}

const calculator = createPerformanceCalculator();
async function enrichScore(score, map = score.beatmap, mode, { effectivePP = false } = {}) {
  const calculation = await calculator.calculate(map, { score, mode });
  const inputs = scoreInputs(score, mode ?? calculation.mode);
  // Adding legacy counts makes the renderer select its legacy branch. Carry the
  // other legacy fields (notably date, score and mods) across that boundary too.
  const legacy = adapter.scoreData(score, score.play_idx ?? 1, calculation.mode);
  if (!own(score, "play_idx")) delete legacy.play_idx;
  return { ...legacy, ...score, ...inputs, beatmap: map, sourceCalculation: calculation,
    completion: calculation.extra_info.map_completion ?? score.completion,
    // The source always calculates, then prefers nonzero API PP for display.
    pp: effectivePP && (score.pp == null || Number(score.pp) === 0) ? calculation.extra_info.play_pp : score.pp };
}

module.exports = { calculate: calculator.calculate, enrichScore, createPerformanceCalculator, runWorker,
  mapInputs, scoreInputs, modInputs, ENGINE_VERSION, FAILURE_MESSAGE };
