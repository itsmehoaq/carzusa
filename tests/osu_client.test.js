const assert = require("node:assert/strict");
const { test, mock } = require("node:test");
const axios = require("axios");
const { createOsuClient, normalizeScore } = require("../utils/osu/osuClient");

const failure = (status, headers = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, headers } });
function setup(overrides = {}) {
  const http = {
    post: mock.fn(async () => ({ data: { access_token: "token", expires_in: 3600 } })),
    get: mock.fn(async () => ({ data: { id: 123, username: "Player" } })),
  };
  const sleep = mock.fn(async () => {});
  return { http, sleep, client: createOsuClient({ http, sleep, clientId: "client", clientSecret: "secret", ...overrides }) };
}

test("default Axios transport has a 10-second timeout; missing credentials cause no requests", async (t) => {
  const http = { post: mock.fn(), get: mock.fn() };
  const create = t.mock.method(axios, "create", () => http);
  const client = createOsuClient({ clientId: "", clientSecret: "" });
  assert.deepEqual(create.mock.calls[0].arguments[0], { timeout: 10_000 });
  await assert.rejects(client.getUser("name"), /not configured/);
  assert.equal(http.post.mock.callCount(), 0);
  assert.equal(http.get.mock.callCount(), 0);
});

test("concurrent requests share one OAuth flight and reuse the token", async () => {
  const { http, client } = setup();
  let release;
  http.post.mock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  const requests = [client.getUser("a b"), client.getBeatmap(10), client.getUser(1, "mania")];
  assert.equal(http.post.mock.callCount(), 1);
  release({ data: { access_token: "shared", expires_in: 3600 } });
  await Promise.all(requests);
  assert.deepEqual(http.post.mock.calls[0].arguments, ["https://osu.ppy.sh/oauth/token", {
    client_id: "client", client_secret: "secret", grant_type: "client_credentials", scope: "public",
  }]);
  assert.match(http.get.mock.calls[0].arguments[0], /a%20b\/osu$/);
  for (const call of http.get.mock.calls) {
    assert.deepEqual(call.arguments[1].headers, { Authorization: "Bearer shared", "x-api-version": "20240529" });
  }
  await client.getUser(2);
  assert.equal(http.post.mock.callCount(), 1);
});

test("token refresh uses a proactive 60-second buffer and releases a failed flight", async () => {
  let clock = 0;
  const { client, http } = setup({ now: () => clock });
  http.post.mock.mockImplementationOnce(async () => { throw failure(400); });
  await assert.rejects(client.getUser(1));
  await client.getUser(1);
  clock = 3_539_999;
  await client.getUser(1);
  assert.equal(http.post.mock.callCount(), 2);
  clock = 3_540_000;
  await client.getUser(1);
  assert.equal(http.post.mock.callCount(), 3);
});

test("401 refresh retries only once; simultaneous 401s share the replacement token", async () => {
  const { client, http } = setup();
  let issued = 0;
  http.post.mock.mockImplementation(async () => ({ data: { access_token: `token${++issued}`, expires_in: 3600 } }));
  http.get.mock.mockImplementation(async (_url, config) => {
    if (config.headers.Authorization === "Bearer token1") throw failure(401);
    return { data: { id: 1 } };
  });
  await Promise.all([client.getUser(1), client.getUser(2)]);
  assert.equal(http.post.mock.callCount(), 2);
  http.get.mock.mockImplementation(async () => { throw failure(401); });
  const before = http.get.mock.callCount();
  await assert.rejects(client.getUser(1));
  assert.equal(http.get.mock.callCount() - before, 2);
  assert.ok(http.get.mock.calls.every((call) => call.arguments[1].headers["x-api-version"] === "20240529"));
});

test("429 honors Retry-After; 5xx retries use bounded exponential backoff", async () => {
  const { client, http, sleep } = setup();
  http.get.mock.mockImplementationOnce(async () => { throw failure(429, { "retry-after": "2" }); });
  await client.getUser(1);
  assert.equal(sleep.mock.calls[0].arguments[0], 2000);
  http.get.mock.mockImplementation(async () => { throw failure(503); });
  const before = http.get.mock.callCount();
  await assert.rejects(client.getUser(1));
  assert.equal(http.get.mock.callCount() - before, 4);
  assert.deepEqual(sleep.mock.calls.slice(1).map((call) => call.arguments[0]), [500, 1000, 2000]);
});

test("Retry-After HTTP dates apply to OAuth retries too; permanent errors are not retried", async () => {
  const { client, http, sleep } = setup({ now: () => Date.parse("2026-01-01T00:00:00Z") });
  http.post.mock.mockImplementationOnce(async () => { throw failure(429, { "retry-after": "Thu, 01 Jan 2026 00:00:03 GMT" }); });
  await client.getUser(1);
  assert.equal(sleep.mock.calls[0].arguments[0], 3000);
  http.get.mock.mockImplementation(async () => { throw failure(404); });
  const before = http.get.mock.callCount();
  await assert.rejects(client.getUser(1));
  assert.equal(http.get.mock.callCount() - before, 1);
});

test("recent/top endpoints normalize legacy and lazer scores and forward ruleset/filter/limits", async () => {
  const { client, http } = setup();
  http.get.mock.mockImplementation(async () => ({ data: [{
    legacy_score_id: 7, legacy_total_score: 12345, accuracy: 0.9876, mods: [{ acronym: "HD" }, "HR"],
    passed: false, rank: "A", pp: null, statistics: { great: 90, ok: 8, miss: 2, large_tick_hit: 100 },
    beatmap: { count_circles: 100, count_sliders: 100, count_spinners: 0 },
  }] }));
  const [score] = await client.getUserRecentScores(1, "osu", true, 999);
  assert.equal(score.id, 7);
  assert.equal(score.total_score, 12345);
  assert.equal(score.accuracy, 98.76);
  assert.deepEqual(score.mods, ["HD", "HR"]);
  assert.equal(score.failed, true);
  assert.equal(score.completion, 50);
  assert.equal(score.pp, null);
  assert.deepEqual(http.get.mock.calls[0].arguments[1].params, { mode: "osu", include_fails: 1, limit: 50 });
  await client.getUserRecentScores(1, "mania", false, 3);
  assert.deepEqual(http.get.mock.calls[1].arguments[1].params, { mode: "mania", include_fails: 0, limit: 3 });
  await client.getUserTopScores(1, "taiko", 999);
  assert.match(http.get.mock.calls[2].arguments[0], /scores\/best$/);
  assert.deepEqual(http.get.mock.calls[2].arguments[1].params, { mode: "taiko", limit: 100 });
  assert.ok(http.get.mock.calls.every((call) => call.arguments[1].headers["x-api-version"] === "20240529"));
});

test("normalization preserves zero IDs/scores and percentage accuracy; supports legacy and mania hits", () => {
  const score = normalizeScore({ id: 0, legacy_score_id: 7, total_score: 0, legacy_total_score: 99, accuracy: 99.5, rank: "F",
    statistics: { count_300: 30, count_100: 10, count_miss: 10 }, beatmap: { count_circles: 100 } });
  assert.equal(score.id, 0);
  assert.equal(score.total_score, 0);
  assert.equal(score.accuracy, 99.5);
  assert.equal(score.completion, 50);
  assert.equal(normalizeScore({ rank: "F" }).completion, null);
  assert.equal(normalizeScore({ passed: true, rank: "S", accuracy: 1 }).accuracy, 100);
  assert.equal(normalizeScore({ ruleset_id: 3, passed: false, statistics: { perfect: 10, great: 20, good: 5, ok: 5, meh: 5, miss: 5 }, maximum_statistics: { perfect: 100 } }).completion, 50);
});

test("match history follows backward pages, merges users, and warns when the 500-event cap truncates", async () => {
  const { client, http } = setup();
  http.get.mock.mockImplementation(async (_url, { params }) => {
    const end = params.before ? params.before - 1 : 600;
    return { data: {
      first_event_id: 1, match: { id: 1, name: "Long match" }, users: [{ id: end, username: `user${end}` }],
      events: Array.from({ length: 100 }, (_, index) => ({ id: end - 99 + index })),
    } };
  });
  const match = await client.getMatch(1);
  assert.equal(http.get.mock.callCount(), 5);
  assert.equal(match.events.length, 500);
  assert.equal(match.events[0].id, 101);
  assert.equal(match.events.at(-1).id, 600);
  assert.equal(match.users.length, 5);
  assert.equal(match.truncated, true);
});

test("complete small match needs no further pages and has no truncation warning", async () => {
  const { client, http } = setup();
  http.get.mock.mockImplementation(async () => ({ data: { first_event_id: 10, events: [{ id: 10 }], users: [] } }));
  assert.equal((await client.getMatch(1)).truncated, false);
  assert.equal(http.get.mock.callCount(), 1);
});

test("numeric username lookup is distinct from ID lookup and encodes the exact username", async () => {
  const { client, http } = setup();
  await client.getUserByUsername("12345");
  await client.getUserByUsername("A B_[x]", "mania");
  await client.getUser("12345", "taiko");
  assert.equal(http.get.mock.calls[0].arguments[0], "https://osu.ppy.sh/api/v2/users/@12345/osu");
  assert.deepEqual(http.get.mock.calls[0].arguments[1].params, { key: "username" });
  assert.equal(http.get.mock.calls[1].arguments[0], "https://osu.ppy.sh/api/v2/users/@A%20B_%5Bx%5D/mania");
  assert.match(http.get.mock.calls[2].arguments[0], /\/users\/12345\/taiko$/);
});

test("score lookup uses unified or ruleset endpoints and normalizes their scores", async () => {
  const { client, http } = setup();
  http.get.mock.mockImplementation(async () => ({ data: { id: 7, accuracy: 0.99, mods: [{ acronym: "HD" }], pp: 123 } }));
  for (const mode of [null, "osu", "taiko", "fruits", "mania"]) {
    const score = await client.getScore(7, mode);
    assert.equal(score.accuracy, 99);
    assert.deepEqual(score.mods, ["HD"]);
    assert.equal(http.get.mock.calls.at(-1).arguments[0], `https://osu.ppy.sh/api/v2/scores/${mode ? `${mode}/` : ""}7`);
  }
  await client.getScore("7/8", "a/b");
  assert.match(http.get.mock.calls.at(-1).arguments[0], /\/scores\/a%2Fb\/7%2F8$/);
});

test("pinned, most-played and performance rankings forward endpoint query parameters", async () => {
  const { client, http } = setup();
  http.get.mock.mockImplementation(async () => ({ data: [{ id: 1, accuracy: 0.5, mods: ["HR"] }] }));
  const scores = await client.getUserPinnedScores("a/b", "fruits", 999);
  assert.equal(scores[0].accuracy, 50);
  assert.match(http.get.mock.calls[0].arguments[0], /\/users\/a%2Fb\/scores\/pinned$/);
  assert.deepEqual(http.get.mock.calls[0].arguments[1].params, { mode: "fruits", limit: 100 });
  await client.getUserMostPlayed(42);
  assert.match(http.get.mock.calls[1].arguments[0], /\/users\/42\/beatmapsets\/most_played$/);
  assert.deepEqual(http.get.mock.calls[1].arguments[1].params, { limit: 100 });
  await client.getPerformanceRankings("mania", 2, "VN");
  assert.match(http.get.mock.calls[2].arguments[0], /\/rankings\/mania\/performance$/);
  assert.deepEqual(http.get.mock.calls[2].arguments[1].params, { page: 2, country: "VN" });
  await client.getPerformanceRankings();
  assert.deepEqual(http.get.mock.calls[3].arguments[1].params, { page: 1 });
});
