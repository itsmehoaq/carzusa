const axios = require("axios");

const API_URL = "https://osu.ppy.sh/api/v2";
const TOKEN_URL = "https://osu.ppy.sh/oauth/token";

function normalizeMods(mods = []) {
  return mods.map((mod) => typeof mod === "string" ? mod : mod.acronym).filter(Boolean);
}

function normalizeScore(score) {
  const statistics = score.statistics || {};
  const mode = score.ruleset_id ?? score.mode_int ?? ({ osu: 0, taiko: 1, fruits: 2, mania: 3 }[score.mode]) ?? 0;
  const keys = mode === 3 ? ["perfect", "great", "good", "ok", "meh", "miss"]
    : mode === 2 ? ["great", "large_tick_hit", "small_tick_hit", "miss", "large_tick_miss", "small_tick_miss"]
      : mode === 1 ? ["great", "ok", "miss"] : ["great", "ok", "meh", "miss"];
  const legacyKeys = mode === 3 ? ["count_geki", "count_300", "count_katu", "count_100", "count_50", "count_miss"]
    : mode === 2 ? ["count_300", "count_100", "count_50", "count_miss", "count_katu"]
      : mode === 1 ? ["count_300", "count_100", "count_miss"] : ["count_300", "count_100", "count_50", "count_miss"];
  const sum = (object, names) => names.reduce((total, key) => total + (Number(object[key]) || 0), 0);
  const hits = sum(statistics, Object.keys(statistics).some((key) => keys.includes(key)) ? keys : legacyKeys);
  const maximum = score.maximum_statistics;
  // Lazer's maximum statistics contain judgments, not misses. Avoid counting slider ticks twice in osu!.
  const maxKeys = keys.filter((key) => !key.includes("miss"));
  const map = score.beatmap || {};
  const total = maximum ? sum(maximum, maxKeys) : mode === 1 ? Number(map.count_circles)
    : [map.count_circles, map.count_sliders, map.count_spinners].reduce((n, value) => n + (Number(value) || 0), 0);
  const failed = score.passed === false || score.rank === "F";
  const accuracy = Number(score.accuracy) || 0;
  return {
    ...score,
    id: score.id ?? score.legacy_score_id,
    total_score: score.total_score ?? score.legacy_total_score ?? score.score ?? 0,
    accuracy: Math.max(0, Math.min(100, accuracy <= 1 ? accuracy * 100 : accuracy)),
    mods: normalizeMods(score.mods),
    failed,
    completion: failed ? (total > 0 ? Math.min(100, hits / total * 100) : null) : 100,
    pp: score.pp ?? null,
  };
}

function createOsuClient({
  http = axios.create({ timeout: 10_000 }),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  clientId = () => process.env.OSU_CLIENT_ID,
  clientSecret = () => process.env.OSU_CLIENT_SECRET,
} = {}) {
  let token;
  let expiresAt = 0;
  let tokenFlight;
  const configValue = (value) => typeof value === "function" ? value() : value;

  async function withBackoff(request) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request();
      } catch (error) {
        const status = error.response?.status;
        if (attempt >= 3 || !(status === 429 || status >= 500 && status <= 599)) throw error;
        const retryAfter = error.response.headers?.["retry-after"];
        const seconds = retryAfter === undefined ? NaN : Number(retryAfter);
        const retryMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now();
        await sleep(Math.max(500 * 2 ** attempt, Number.isFinite(retryMs) ? retryMs : 0));
      }
    }
  }

  async function getToken() {
    if (token && now() < expiresAt - 60_000) return token;
    if (!tokenFlight) {
      tokenFlight = (async () => {
        const id = configValue(clientId);
        const secret = configValue(clientSecret);
        if (!id || !secret) throw new Error("osu! API is not configured (OSU_CLIENT_ID and OSU_CLIENT_SECRET).");
        const { data } = await withBackoff(() => http.post(TOKEN_URL, {
          client_id: id, client_secret: secret, grant_type: "client_credentials", scope: "public",
        }));
        if (!data.access_token || !(Number(data.expires_in) > 0)) throw new Error("Invalid osu! OAuth response.");
        token = data.access_token;
        expiresAt = now() + Number(data.expires_in) * 1000;
        return token;
      })();
    }
    try {
      return await tokenFlight;
    } finally {
      tokenFlight = undefined;
    }
  }

  async function get(path, params) {
    for (let authAttempt = 0; ; authAttempt++) {
      const usedToken = await getToken();
      try {
        const response = await withBackoff(() => http.get(`${API_URL}${path}`, {
          headers: { Authorization: `Bearer ${usedToken}`, "x-api-version": "20240529" }, params,
        }));
        return response.data;
      } catch (error) {
        if (error.response?.status !== 401 || authAttempt >= 1) throw error;
        if (token === usedToken) { token = undefined; expiresAt = 0; }
      }
    }
  }

  return {
    getUser: (usernameOrId, mode = "osu") => get(`/users/${encodeURIComponent(usernameOrId)}/${mode}`),
    async getUserRecentScores(userId, mode = "osu", includeFails = true, limit = 50) {
      const data = await get(`/users/${encodeURIComponent(userId)}/scores/recent`, {
        mode, include_fails: includeFails ? 1 : 0, limit: Math.max(1, Math.min(50, limit)),
      });
      return data.map(normalizeScore);
    },
    async getUserTopScores(userId, mode = "osu", limit = 100) {
      const data = await get(`/users/${encodeURIComponent(userId)}/scores/best`, {
        mode, limit: Math.max(1, Math.min(100, limit)),
      });
      return data.map(normalizeScore);
    },
    getBeatmap: (beatmapId) => get(`/beatmaps/${encodeURIComponent(beatmapId)}`),
    async getMatch(matchId) {
      const path = `/matches/${encodeURIComponent(matchId)}`;
      const initial = await get(path, { limit: 100 });
      const events = new Map((initial.events || []).map((event) => [event.id, event]));
      const users = new Map((initial.users || []).map((user) => [user.id, user]));
      let page = initial;
      for (let pages = 1; pages < 5; pages++) {
        const oldest = Math.min(...page.events.map((event) => event.id));
        if (!page.events.length || oldest <= initial.first_event_id) break;
        const next = await get(path, { limit: 100, before: oldest });
        if (!next.events?.length) break;
        for (const event of next.events) events.set(event.id, event);
        for (const user of next.users || []) users.set(user.id, user);
        page = next;
        if (Math.min(...page.events.map((event) => event.id)) >= oldest) break;
      }
      const sorted = [...events.values()].sort((a, b) => a.id - b.id);
      return {
        ...initial,
        events: sorted.slice(-500),
        users: [...users.values()],
        truncated: sorted.length > 500 || (sorted.length > 0 && sorted[0].id > initial.first_event_id),
      };
    },
  };
}

module.exports = { ...createOsuClient(), createOsuClient, normalizeScore, normalizeMods };
