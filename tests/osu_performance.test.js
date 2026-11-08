const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const { readFileSync } = require("node:fs");
const { execFileSync, spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const path = require("node:path");
const axios = require("axios");
const performance = require("../utils/osu/calculations/performance");
const { normalizeScore } = require("../utils/osu/osuClient");
const { paginate } = require("../utils/osu/paginationHelper");
const fixtures = path.join(__dirname, "fixtures/osu/performance");
const read = name => readFileSync(path.join(fixtures, name), "utf8");
const recorded = JSON.parse(read("oracle-local.json"));
const raw = read("2469345.osu");
const mapKeys = ["beatmap_id", "mode", "difficulty_rating", "max_combo", "cs", "od", "ar", "hp", "hit_length", "total_length", "bpm", "count_circles", "count_sliders", "count_spinners"];
const map = Object.fromEntries(mapKeys.map(key => [key, recorded[0].result[key]]));
const play = { count_300: 280, count_100: 10, count_50: 2, count_miss: 3, count_geki: 4, count_katu: 1, max_combo: 250, rank: "A", score: 975000 };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const sha = value => createHash("sha256").update(value).digest("hex");

function sameNumbers(actual, expected, field = "result") {
  if (field.endsWith(".error") && typeof expected === "string") {
    // Python versions change built-in exception wording, not the source failure type.
    assert.equal(actual.split(":")[0], expected.split(":")[0], field);
  } else if (typeof expected === "number") {
    assert.ok(typeof actual === "number" && Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `${field}: ${actual} != ${expected}`);
  } else if (expected && typeof expected === "object") {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), field);
    for (const key of Object.keys(expected)) sameNumbers(actual[key], expected[key], `${field}.${key}`);
  } else assert.equal(actual, expected, field);
}

test("ported function ASTs and vendored engine match the independent original snapshot and pinned hashes", () => {
  const script = `
import ast, hashlib, json
from pathlib import Path
p=Path(${JSON.stringify(fixtures)})
t=ast.parse((p/'oracle.py').read_text())
payload=ast.literal_eval(next(n.value for n in t.body if isinstance(n,ast.Assign) and any(isinstance(x,ast.Name) and x.id=='payload' for x in n.targets)))
root=Path(${JSON.stringify(path.join(__dirname, "../utils/osu/calculations/performance"))})
ported={n.name:(n,(root/f).read_text()) for f in ['formulas.py','score_utils.py'] for n in ast.parse((root/f).read_text()).body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
original={n.name:(n,payload[k]) for k in ['calc','utils'] for n in ast.parse(payload[k]).body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
for name,(node,text) in ported.items():
 assert ast.dump(node,include_attributes=False)==ast.dump(original[name][0],include_attributes=False),name
 assert ast.get_source_segment(text,node)==ast.get_source_segment(original[name][1],original[name][0]),name
assert (root/'vendor/engine.py').read_text()==payload['engine']
print(json.dumps({name:hashlib.sha256(ast.get_source_segment(text,n).encode()).hexdigest() for name,(n,text) in ported.items()}))
`;
  const hashes = JSON.parse(execFileSync("/usr/bin/python3", ["-c", script], { encoding: "utf8" }));
  const provenance = JSON.parse(read("provenance.json"));
  assert.deepEqual(hashes, provenance.functionSourceSHA256);
  assert.equal(sha(readFileSync(path.join(__dirname, "../utils/osu/calculations/performance/vendor/engine.py"))), provenance.engineSHA256);
  assert.equal(sha(Buffer.from(raw)), provenance.rawSHA256);
});

test("independent original oracle still reproduces all 80 recorded local and production ARM results", () => {
  const result = JSON.parse(execFileSync("/usr/bin/python3", [path.join(fixtures, "oracle.py")], { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 }));
  sameNumbers(result, recorded);
  sameNumbers(result, JSON.parse(read("oracle-arm.json")));
  assert.equal(result.length, 80);
});

test("actual worker and JS adapter reproduce every field of all 80 original four-ruleset fixtures", async () => {
  const fetchRaw = mock.fn(async () => raw);
  const calculator = performance.createPerformanceCalculator({ fetchRaw });
  for (const fixture of recorded) {
    const result = await calculator.calculate({ ...map, mode: fixture.mode }, {
      mods: fixture.mods, score: { ...play, rank: fixture.rank },
    });
    sameNumbers(result, fixture.result, `mode${fixture.mode}/mods${fixture.mods}/${fixture.rank}`);
  }
  assert.equal(fetchRaw.mock.callCount(), 1);
});

test("native maps, mania hold notes/score thresholds, NC-only/PF, zero/null combo and source oddities match independent oracle", async () => {
  const cases = JSON.parse(read("cases.json"));
  const original = JSON.parse(execFileSync("/usr/bin/python3", [path.join(fixtures, "extended-oracle.py")], { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 }));
  sameNumbers(original, JSON.parse(read("extended-oracle.json")));
  for (let index = 0; index < cases.length; index++) {
    const fixture = cases[index];
    const request = { ...fixture.request, raw: read(fixture.rawFile) };
    if (original[index].error) {
      await assert.rejects(performance.runWorker(request), error => error.message.includes(original[index].error.split(":")[0]), fixture.name);
    } else sameNumbers(await performance.runWorker(request), original[index].result, fixture.name);
  }
});

test("modern judgments map by ruleset; explicit legacy zeros, mania legacy score and metadata nulls survive", () => {
  const stats = { great: 10, ok: 2, meh: 1, miss: 3, perfect: 4, good: 5, large_tick_hit: 6, large_tick_miss: 7, small_tick_hit: 8, small_tick_miss: 9, slider_tail_hit: 999, slider_tick_hit: 999 };
  const score = { statistics: stats, max_combo: 12, rank: "A", total_score: 999999, legacy_total_score: 700000 };
  assert.deepEqual(performance.scoreInputs(score, 0), { count_300: 10, count_100: 2, count_50: 1, count_miss: 3, count_geki: 0, count_katu: 0, max_combo: 12, rank: "A", score: 999999 });
  assert.equal(performance.scoreInputs(score, 1).count_50, 0);
  assert.deepEqual(performance.scoreInputs(score, 2), { count_300: 10, count_100: 6, count_50: 8, count_miss: 10, count_geki: 0, count_katu: 9, max_combo: 12, rank: "A", score: 999999 });
  assert.deepEqual(performance.scoreInputs(score, 3), { count_300: 10, count_100: 2, count_50: 1, count_miss: 3, count_geki: 4, count_katu: 5, max_combo: 12, rank: "A", score: 700000 });
  for (let mode = 0; mode < 4; mode++) {
    const legacy = performance.scoreInputs({ ...score, count_300: 0, count_miss: 0, score: 0 }, mode);
    assert.equal(legacy.count_300, 0); assert.equal(legacy.count_miss, 0); assert.equal(legacy.score, 0);
  }
  const metadata = performance.mapInputs({ id: 2469345, accuracy: null, drain: 0, max_combo: null }, 0);
  assert.equal(metadata.od, null); assert.equal(metadata.hp, 0); assert.equal(metadata.max_combo, null);
  assert.equal(performance.mapInputs({ ...map, od: 0, hp: null }).hp, null);
  assert.equal(performance.scoreInputs({ ...score, total_score: 97269, legacy_total_score: 0 }, 0).score, 97269);
  assert.equal(performance.scoreInputs({ ...score, total_score: 97269, legacy_total_score: 0 }, 3).score, 0);
});

test("raw mod settings are retained and unsupported settings fail before downloading; NC and PF use original conversion", async () => {
  const normalized = normalizeScore({ ruleset_id: 3, mods: [{ acronym: "DT", settings: { speed_change: 1.2 } }], legacy_total_score: 0, score: 0 });
  assert.deepEqual(normalized.mods, ["DT"]);
  assert.deepEqual(normalized.raw_mods, [{ acronym: "DT", settings: { speed_change: 1.2 } }]);
  assert.equal(normalized.legacy_total_score, 0); assert.equal(normalized.score, 0);
  const fetchRaw = mock.fn(async () => raw);
  const calculator = performance.createPerformanceCalculator({ fetchRaw });
  await assert.rejects(calculator.calculate(map, { score: normalized }), /calculator is unavailable/);
  assert.equal(fetchRaw.mock.callCount(), 0);
  assert.throws(() => performance.modInputs({ mods: [{ acronym: "DA", settings: {} }] }), /Unsupported/);
  assert.throws(() => performance.modInputs({ mods: "FOO" }), /Unsupported/);
  const nc = await calculator.calculate(map, { mods: ["NC"], score: play });
  sameNumbers(nc, recorded.find(f => f.mode === 0 && f.mods === 576 && f.rank === "A").result);
  const onlyNc = await calculator.calculate(map, { mods: 512, score: play });
  const originalNc = JSON.parse(read("extended-oracle.json")).find(f => f.name === "mode0-mods512");
  sameNumbers(onlyNc, originalNc.result);
  const pf = await calculator.calculate(map, { mods: ["PF"], score: play });
  const pfNumeric = await calculator.calculate(map, { mods: 16416, score: play });
  sameNumbers(pf, pfNumeric);
});

test("bounded single-flight queue, cache copies, relevant inputs, raw checksum/expiry and failure retries", async () => {
  let clock = 0, active = 0, peak = 0;
  const gate = deferred();
  let block = true;
  const fetchRaw = mock.fn(async () => raw);
  const worker = mock.fn(async request => {
    active++; peak = Math.max(peak, active);
    if (block) await gate.promise;
    active--;
    return { pp_mod: [1, 2, 3], extra_info: { play_pp: request.extra.play_info?.score ?? 1 }, checksum: sha(request.raw) };
  });
  const calculator = performance.createPerformanceCalculator({ fetchRaw, worker, queueLimit: 1, now: () => clock });
  const first = calculator.calculate(map, { score: play });
  const duplicate = calculator.calculate(map, { score: { ...play } });
  const second = calculator.calculate(map, { score: { ...play, score: 1 } });
  await assert.rejects(calculator.calculate(map, { score: { ...play, score: 2 } }), /calculator is unavailable/);
  block = false; gate.resolve();
  const [a, b] = await Promise.all([first, duplicate, second]);
  assert.equal(peak, 1); assert.equal(worker.mock.callCount(), 2); assert.equal(fetchRaw.mock.callCount(), 1);
  a.pp_mod[0] = 999; assert.equal(b.pp_mod[0], 1);
  assert.equal((await calculator.calculate(map, { score: play })).pp_mod[0], 1);
  assert.equal(worker.mock.callCount(), 2);
  await calculator.calculate({ ...map, od: 0 }, { score: play });
  await calculator.calculate(map, { score: { ...play, max_combo: 0 } });
  await calculator.calculate(map, { score: play, mods: 64 });
  await calculator.calculate(map, { score: play, beatmapMod: { ...map, ar: 10 } });
  assert.equal(worker.mock.callCount(), 6);
  clock = 3600_001;
  fetchRaw.mock.mockImplementation(async () => raw + "\n// changed raw\n");
  await calculator.calculate(map, { score: play });
  assert.equal(worker.mock.callCount(), 7); assert.equal(fetchRaw.mock.callCount(), 2);
  worker.mock.mockImplementationOnce(async () => { throw new Error("worker failed"); });
  await assert.rejects(calculator.calculate(map, { mods: 16 }), /calculator is unavailable/);
  await calculator.calculate(map, { mods: 16 });
  assert.equal(worker.mock.callCount(), 9);
});

test("raw and calculation LRUs evict within byte budgets; oversized downloads and invalid IDs fail closed", async () => {
  const fetchRaw = mock.fn(async () => raw);
  const worker = mock.fn(async () => ({ pp_mod: [1, 2, 3], extra_info: {} }));
  const calculator = performance.createPerformanceCalculator({ fetchRaw, worker, rawCacheBytes: Buffer.byteLength(raw), calculationCacheBytes: 1 });
  for (const id of [1, 2, 1]) await calculator.calculate({ ...map, beatmap_id: id });
  assert.equal(fetchRaw.mock.callCount(), 3); assert.equal(worker.mock.callCount(), 3);
  for (const id of ["https://evil.example/a", "0", "1/../../x", -1]) await assert.rejects(calculator.calculate({ ...map, beatmap_id: id }));
  assert.equal(fetchRaw.mock.callCount(), 3);
  const huge = performance.createPerformanceCalculator({ fetchRaw: async () => Buffer.alloc(4 * 1024 * 1024 + 1), worker });
  await assert.rejects(huge.calculate(map)); assert.equal(worker.mock.callCount(), 3);
  let calls = 0;
  const retry = performance.createPerformanceCalculator({ fetchRaw: async () => { if (++calls === 1) throw new Error("download failed"); return raw; }, worker });
  await assert.rejects(retry.calculate(map)); await retry.calculate(map); assert.equal(calls, 2);
});

test("default download transport is restricted to the official raw endpoint with deadline and size/redirect bounds", async t => {
  const download = t.mock.method(axios, "get", async (url, options) => {
    assert.equal(url, "https://osu.ppy.sh/osu/2469345");
    assert.equal(options.timeout, 10000); assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.maxContentLength, 4 * 1024 * 1024);
    assert.equal(options.maxBodyLength, 4 * 1024 * 1024); assert.equal(options.maxRedirects, 0);
    return { data: Buffer.from(raw) };
  });
  const calculator = performance.createPerformanceCalculator();
  await calculator.calculate(map, { score: play });
  assert.equal(download.mock.callCount(), 1);
});

function fakeProcess(onStart) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = mock.fn(() => { queueMicrotask(() => child.emit("close", null)); });
  queueMicrotask(() => onStart?.(child));
  return child;
}

test("worker wall timeout, stdout/stderr limits, bad JSON, exits, and malformed maps reject without PP fabrication", async () => {
  const starts = [undefined, child => child.stdout.write("x".repeat(100)), child => child.stderr.write("x".repeat(100)), child => { child.stdout.write("invalid"); child.emit("close", 0); }, child => child.emit("close", 1)];
  for (const [index, start] of starts.entries()) {
    let child;
    await assert.rejects(performance.runWorker({}, { spawnProcess: () => child = fakeProcess(start), timeoutMs: 20, outputLimit: 64 }));
    assert.equal(child.kill.mock.callCount(), index < 3 ? 1 : 0);
  }
  for (const bad of ["<html>not a map", "osu file format v14\n[HitObjects]\n", "osu file format v14\n[HitObjects]\n0,0,0,2,0,B|0:0,999999,100\n"]) {
    await assert.rejects(performance.runWorker({ raw: bad, map }), /worker failed/);
  }
  const result = await performance.runWorker({ raw, map, extra: { play_info: play } });
  assert.ok(result.extra_info.play_pp > 0);
  let downloads = 0;
  const retry = performance.createPerformanceCalculator({ fetchRaw: async () => ++downloads === 1 ? "<html>temporary error" : raw });
  await assert.rejects(retry.calculate(map, { score: play }));
  sameNumbers(await retry.calculate(map, { score: play }), recorded[0].result);
  assert.equal(downloads, 2);
});

test("real subprocess timeout and output enforcement kill stalled/noisy workers, then actual calculation recovers", async () => {
  const subprocess = source => (binary, _args, options) => spawn(binary, ["-c", source], options);
  await assert.rejects(performance.runWorker({}, { spawnProcess: subprocess("while True: pass"), timeoutMs: 50 }), /timed out/);
  await assert.rejects(performance.runWorker({}, { spawnProcess: subprocess("print('x' * 10000, flush=True)"), outputLimit: 128 }), /output limit/);
  const recovered = await performance.runWorker({ raw, map, extra: { play_info: { ...play } } });
  sameNumbers(recovered, recorded[0].result);
  const workerSource = readFileSync(path.join(__dirname, "../utils/osu/calculations/performance/worker.py"), "utf8");
  assert.match(workerSource, /RLIMIT_CPU, \(10, 10\)/);
  assert.match(workerSource, /RLIMIT_AS, \(256 \* 1024 \* 1024, 256 \* 1024 \* 1024\)/);
});

test("real worker installs host CPU limits and enforces host memory bounds", async () => {
  const workerDirectory = path.join(__dirname, "../utils/osu/calculations/performance");
  const script = `import sys,json,resource; sys.path.insert(0,${JSON.stringify(workerDirectory)}); import worker; print(json.dumps([resource.getrlimit(resource.RLIMIT_CPU),resource.getrlimit(resource.RLIMIT_AS)]))`;
  const limits = JSON.parse(execFileSync("/usr/bin/python3", ["-B", "-c", script], { encoding: "utf8" }));
  assert.equal(limits[0][0], 10);
  if (process.platform === "linux") assert.equal(limits[1][0], 256 * 1024 * 1024);
  if (process.platform === "darwin") {
    const allocate = (binary, _args, options) => spawn(binary, ["-c", "import time; memory=bytearray(300*1024*1024); time.sleep(5)"], options);
    await assert.rejects(performance.runWorker({}, { spawnProcess: allocate, timeoutMs: 3000 }), /memory limit exceeded/);
  }
  const recovered = await performance.runWorker({ raw, map, extra: { play_info: { ...play } } });
  sameNumbers(recovered, recorded[0].result);
});

function interaction(command, values = {}) {
  const collector = new EventEmitter();
  const get = name => values[name] ?? null;
  return {
    guildId: "723867861600174090", user: { id: "owner", username: "Tester" },
    options: { getSubcommand: () => command, getString: get, getInteger: get, getBoolean: get },
    deferReply: mock.fn(async () => {}),
    editReply: mock.fn(async () => ({ createMessageComponentCollector: () => collector })), collector,
  };
}

test("lazy pagination defers before heavy work, serializes navigation, retries failed pages and expires safely", async () => {
  const i = interaction();
  const gate = deferred();
  let ack = false, fail = true;
  const pages = [mock.fn(async () => ({ content: "one" })), mock.fn(async () => {
    assert.equal(ack, true); await gate.promise;
    if (fail) { fail = false; throw new Error("calculator unavailable"); }
    return { content: "two" };
  }), mock.fn(async () => ({ content: "three" }))];
  await paginate(i, pages);
  assert.equal(pages[0].mock.callCount(), 1); assert.equal(pages[1].mock.callCount(), 0);
  const button = { user: i.user, customId: "osu:next", deferUpdate: mock.fn(async () => { ack = true; }) };
  i.collector.emit("collect", button); await tick();
  assert.equal(button.deferUpdate.mock.callCount(), 1); assert.equal(i.editReply.mock.callCount(), 1);
  gate.resolve(); await tick();
  assert.match(i.editReply.mock.calls.at(-1).arguments[0].content, /unavailable/);
  i.collector.emit("collect", button); await tick();
  assert.equal(i.editReply.mock.calls.at(-1).arguments[0].content, "two");
  i.collector.emit("collect", button); await tick();
  assert.equal(i.editReply.mock.calls.at(-1).arguments[0].content, "three");
  button.customId = "osu:prev"; i.collector.emit("collect", button); await tick();
  assert.equal(pages[1].mock.callCount(), 2);
  i.collector.emit("end"); await tick();
  assert.ok(i.editReply.mock.calls.at(-1).arguments[0].components[0].toJSON().components.every(c => c.disabled));
  const calls = i.editReply.mock.callCount();
  i.collector.emit("collect", button); await tick(); assert.equal(i.editReply.mock.callCount(), calls);
});

test("page timeout during an unresolved calculation cannot re-enable controls", async () => {
  const i = interaction(), gate = deferred();
  await paginate(i, [() => ({ content: "one" }), async () => { await gate.promise; return { content: "two" }; }]);
  i.collector.emit("collect", { user: i.user, customId: "osu:next", deferUpdate: async () => {} }); await tick();
  i.collector.emit("end"); gate.resolve(); await tick();
  for (const call of i.editReply.mock.calls.slice(1)) assert.ok(call.arguments[0].components[0].toJSON().components.every(c => c.disabled));
});

test("real calculations render through the existing source templates with full legacy dates/counts in all rulesets", async t => {
  t.mock.method(axios, "get", async () => ({ data: Buffer.from(raw) }));
  const embeds = require("../utils/osu/embeds");
  // Reuse explicitly synthetic test assets; these are never runtime defaults.
  const options = require("./fixtures/osuPresentation/contracts.json")[0].options;
  for (const [mode, name] of ["osu", "taiko", "fruits", "mania"].entries()) {
    const beatmap = { id: 2469345, mode: name, cs: map.cs, ar: map.ar, accuracy: map.od, drain: map.hp,
      bpm: map.bpm, max_combo: map.max_combo, hit_length: map.hit_length, total_length: map.total_length,
      difficulty_rating: map.difficulty_rating, count_circles: map.count_circles, count_sliders: map.count_sliders,
      count_spinners: map.count_spinners, version: "Native", beatmapset: { id: 1, artist: "A", title: "T", creator: "C" } };
    const score = normalizeScore({ id: 1, beatmap, ruleset_id: mode, mods: [], passed: true, rank: "A", pp: null,
      accuracy: 0.98, max_combo: 250, total_score: 975000, legacy_total_score: 975000, ended_at: "2020-01-01T00:00:00Z",
      statistics: { great: 280, ok: 10, meh: 2, miss: 3, perfect: 4, good: 1, large_tick_hit: 10, small_tick_hit: 2, large_tick_miss: 7, small_tick_miss: 1 } });
    const enriched = await performance.enrichScore(score, beatmap, name);
    assert.equal(enriched.date, "2020-01-01 00:00:00");
    assert.equal(enriched.beatmap_id, 2469345);
    assert.equal(enriched.score, 975000);
    assert.equal(enriched.play_idx, undefined);
    assert.equal(enriched.pp, null);
    assert.ok(enriched.sourceCalculation.extra_info.play_pp > 0);
    if (mode === 2) assert.equal(enriched.count_miss, 10);
    const user = { id: 42, username: "Player", country_code: "VN" };
    const recent = embeds.scoreEmbed(enriched, user, { ...options, mode: name }).toJSON();
    const top = embeds.scoreListEmbed([enriched, enriched], user, { ...options, mode: name }).toJSON();
    assert.match(recent.description, /PP/); assert.doesNotMatch(recent.description, /NaN|undefined/);
    assert.match(top.description, /Score Set/); assert.doesNotMatch(top.description, /NaN|undefined/);
    assert.match(top.description, /\*\*1\. \[/); assert.match(top.description, /\*\*2\. \[/);
  }
});

test("default handlers render real calculated PP with empty glyph slots instead of invented emotes", async t => {
  const api = require("../utils/osu/osuClient");
  const { executeOsu } = require("../utils/osu/commandHandlers");
  const { beatmap_id, ...attributes } = map;
  const beatmap = { ...attributes, id: 2469345, mode: "osu", accuracy: map.od, drain: map.hp,
    status: 1, version: "Native", beatmapset: { id: 1, artist: "A", title: "T", creator: "C",
      user_id: 42, favourite_count: 1, ranked_date: "2020-01-01T00:00:00Z", last_updated: "2020-01-01T00:00:00Z" } };
  const user = { id: 42, username: "Player", country_code: "VN" };
  const score = normalizeScore({ id: 1, beatmap, ruleset_id: 0, rank: "A", passed: true,
    accuracy: 0.98, mods: [], max_combo: 250, total_score: 975000, pp: null,
    statistics: { great: 280, ok: 10, meh: 2, miss: 3 }, ended_at: "2020-01-01T00:00:00Z" });
  t.mock.method(axios, "get", async () => ({ data: Buffer.from(raw) }));
  t.mock.method(require("../utils/osu/osuDb"), "getLinkedUser", async () => ({ osu_id: 42, default_mode: "osu" }));
  t.mock.method(api, "getUser", async () => user);
  t.mock.method(api, "getUserRecentScores", async () => [score]);
  t.mock.method(api, "getUserTopScores", async () => [score]);
  t.mock.method(api, "getBeatmap", async () => structuredClone(beatmap));
  for (const [command, values] of [["recent", {}], ["top", {}], ["map", { beatmap_id_or_url: "2469345" }]]) {
    const i = interaction(command, values);
    await executeOsu(i);
    const payload = i.editReply.mock.calls[0].arguments[0];
    assert.ok(payload.embeds?.length, `${command}: ${JSON.stringify(payload)}`);
    const embed = payload.embeds[0].toJSON();
    assert.doesNotMatch(JSON.stringify(embed), /template-rank|requires .* asset|undefined|NaN/);
    assert.match(JSON.stringify(embed), /PP/);
    assert.equal(embed.author.name.includes("Native"), command === "recent");
  }
});

test("actual command paths calculate API-PP scores, fallback pinned/scorepost PP, lazy pages, and honor guild guard", async t => {
  const api = require("../utils/osu/osuClient");
  const embeds = require("../utils/osu/embeds");
  const { executeOsu } = require("../utils/osu/commandHandlers");
  const { EmbedBuilder } = require("discord.js");
  const user = { id: 42, username: "Player" };
  const v2map = { ...map, id: 2469345, mode: "osu", accuracy: map.od, drain: map.hp, version: "Native", beatmapset: { id: 1, artist: "A", title: "T", creator: "C" } };
  const score = { ...play, id: 1, beatmap: v2map, beatmap_id: 2469345, mods: [], pp: 456, user, statistics: {} };
  const download = t.mock.method(axios, "get", async (url, options) => {
    assert.equal(url, "https://osu.ppy.sh/osu/2469345");
    assert.equal(options.timeout, 10000); assert.equal(options.maxContentLength, 4 * 1024 * 1024); assert.equal(options.maxRedirects, 0);
    return { data: Buffer.from(raw) };
  });
  t.mock.method(require("../utils/osu/osuDb"), "getLinkedUser", async () => ({ osu_id: 42, default_mode: "osu" }));
  const maps = t.mock.method(api, "getBeatmap", async () => structuredClone(v2map));
  t.mock.method(api, "getUser", async () => user);
  t.mock.method(api, "getUserRecentScores", async () => Array.from({ length: 50 }, () => structuredClone(score)));
  t.mock.method(api, "getUserTopScores", async () => Array.from({ length: 100 }, (_, i) => ({ ...score, id: i + 1 })));
  t.mock.method(api, "getUserPinnedScores", async () => Array.from({ length: 100 }, (_, i) => ({ ...score, id: i + 1, pp: null })));
  t.mock.method(api, "getScore", async () => ({ ...score, pp: 0 }));
  const seen = [];
  const embed = () => new EmbedBuilder().setTitle("Captured calculation");
  t.mock.method(embeds, "scoreEmbed", enriched => { seen.push(enriched); return embed(); });
  t.mock.method(embeds, "scoreListEmbed", scores => { seen.push(...scores); return embed(); });
  t.mock.method(embeds, "pinnedEmbed", (scores, _user, options) => { seen.push(...scores.slice(options.page * 5, options.page * 5 + 5)); return embed(); });
  t.mock.method(embeds, "scorepostEmbed", (enriched, _user, title) => { seen.push(enriched); assert.ok(title.includes(`${enriched.sourceCalculation.extra_info.play_pp.toFixed(2)}pp`)); return embed(); });
  t.mock.method(embeds, "beatmapMessage", enriched => { assert.ok(enriched.sourceCalculation.pp_mod[2] > 0); return { embeds: [embed()] }; });
  for (const [command, values, count] of [["recent", {}, 1], ["top", {}, 5], ["top", { index: 99 }, 1]]) {
    seen.length = 0; const i = interaction(command, values); await executeOsu(i);
    assert.equal(seen.length, count, JSON.stringify(i.editReply.mock.calls[0].arguments[0]));
    for (const enriched of seen) {
      assert.equal(enriched.pp, 456);
      sameNumbers(enriched.sourceCalculation.extra_info, recorded[0].result.extra_info);
    }
  }
  seen.length = 0; maps.mock.resetCalls();
  const pinned = interaction("pinned"); await executeOsu(pinned);
  assert.equal(seen.length, 5); assert.equal(maps.mock.callCount(), 1);
  for (const enriched of seen) assert.equal(enriched.pp, enriched.sourceCalculation.extra_info.play_pp);
  pinned.collector.emit("collect", { user: pinned.user, customId: "osu:next", deferUpdate: async () => {} });
  // Cached worker output makes this navigation deterministic without network waits.
  for (let tries = 0; tries < 20 && seen.length < 10; tries++) await tick();
  assert.equal(seen.length, 10); assert.equal(maps.mock.callCount(), 1);
  const post = interaction("scorepost", { score_id_or_url: "1" }); await executeOsu(post);
  assert.equal(seen.at(-1).pp, seen.at(-1).sourceCalculation.extra_info.play_pp);
  await executeOsu(interaction("map", { beatmap_id_or_url: "2469345" }));
  assert.ok(download.mock.callCount() <= 1); // The earlier real-render test may have warmed the shared raw cache.
  for (const command of ["recent", "top", "pinned", "scorepost", "map"]) {
    const denied = interaction(command); denied.guildId = "another-server"; await executeOsu(denied);
    assert.equal(denied.deferReply.mock.callCount(), 0); assert.equal(denied.editReply.mock.callCount(), 0);
  }
  t.mock.method(performance, "enrichScore", async () => { throw new Error(performance.FAILURE_MESSAGE); });
  const failed = interaction("recent"); await executeOsu(failed);
  assert.equal(failed.editReply.mock.calls[0].arguments[0].embeds, undefined);
  assert.equal(failed.editReply.mock.calls[0].arguments[0].content, performance.FAILURE_MESSAGE);
});
