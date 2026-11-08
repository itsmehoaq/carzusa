const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test, mock } = require("node:test");
const { MessageFlags, EmbedBuilder } = require("discord.js");
const api = require("../utils/osu/osuClient");
const db = require("../utils/osu/osuDb");
const { resolveTarget } = require("../utils/osu/osuTargetResolver");
const { paginate } = require("../utils/osu/paginationHelper");
const { parseResourceId, parseScoreResourceId, parseRankTarget } = require("../utils/osu/commandHandlers");
const embeds = require("../utils/osu/embeds");
const osu = require("../commands/osu");

const user = {
  id: 42, username: "Player", country_code: "VN", avatar_url: "https://a.ppy.sh/42",
  join_date: "2020-01-01T00:00:00Z", statistics: { pp: 5000, global_rank: 1000, country_rank: 10, hit_accuracy: 98.5, play_count: 100, level: { current: 100, progress: 25 } },
};
const map = {
  status: "ranked",
  id: 12, cs: 4, ar: 9, accuracy: 8, drain: 6, bpm: 180, total_length: 123, difficulty_rating: 5.1, version: "Insane",
  beatmapset: { id: 10, artist: "Artist", title: "Song", creator: "Mapper", covers: { cover: "https://assets.ppy.sh/cover.jpg" } },
};
const play = {
  id: 1, total_score: 123456, accuracy: 98.76, max_combo: 400, mods: ["HD"], rank: "A", pp: null,
  statistics: { great: 100, ok: 10, miss: 2 }, beatmap: map, failed: false, ended_at: "2026-01-01T00:00:00Z",
};
// Synthetic presentation contracts exercise wiring only; they do not prove runtime PP/assets.
const templateContract = require("./fixtures/osuPresentation/contracts.json")[0];
const templateOptions = { ...templateContract.options };
const templateCalculation = { ...templateContract.calculation, title: "Song", artist: "Artist", creator: "Mapper", version: "Insane" };
map.sourceCalculation = templateCalculation;
play.sourceCalculation = templateCalculation;
function injectTemplateAssets(t) {
  const performance = require("../utils/osu/calculations/performance");
  t.mock.method(performance, "calculate", async () => structuredClone(templateCalculation));
  t.mock.method(performance, "enrichScore", async (score, beatmap) => ({ ...score, beatmap, sourceCalculation: structuredClone(score.sourceCalculation ?? templateCalculation) }));
  for (const name of ["scoreEmbed", "scoreListEmbed", "beatmapEmbed", "beatmapMessage"]) {
    const original = embeds[name];
    t.mock.method(embeds, name, (value, userOrOptions, options) => name.startsWith("beatmap")
      ? original(value, { ...templateOptions, ...userOrOptions, rankEmotes: templateOptions.rankEmotes, diffEmotes: templateOptions.diffEmotes })
      : original(value, userOrOptions, { ...templateOptions, ...options, rankEmotes: templateOptions.rankEmotes, diffEmotes: templateOptions.diffEmotes }));
  }
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

function interaction(command = "profile", values = {}) {
  let deferred = false;
  const collector = new EventEmitter();
  const createCollector = mock.fn(() => collector);
  const get = (name) => {
    assert.equal(deferred, true, `Option ${name} read before deferral finished`);
    return values[name] ?? null;
  };
  return {
    guildId: "723867861600174090",
    user: { id: "123", username: "Tester" },
    options: {
      getSubcommand: () => { assert.equal(deferred, true); return command; },
      getString: get, getInteger: get, getBoolean: get, getNumber: get,
    },
    deferReply: mock.fn(async () => { await tick(); deferred = true; }),
    editReply: mock.fn(async () => ({ createMessageComponentCollector: createCollector })),
    collector, createCollector,
    assertDeferred: () => assert.equal(deferred, true),
  };
}

test("all osu subcommands and standalone aliases silently skip other servers and DMs", async () => {
  const commands = Object.keys(require("../utils/osu/commandOptions").DESCRIPTIONS);
  const aliases = ["rs", "top", "mc", "avatar", "pinned", "mostplayed", "checkname", "badges", "reach", "rank", "pp", "scorepost"];
  for (const guildId of ["other-server", null, undefined]) {
    for (const name of commands) {
      const i = interaction(name);
      i.guildId = guildId;
      await osu.execute(i);
      assert.equal(i.deferReply.mock.callCount(), 0);
      assert.equal(i.editReply.mock.callCount(), 0);
    }
    for (const alias of aliases) {
      const i = interaction();
      i.guildId = guildId;
      await require(`../commands/${alias}`).execute(i);
      assert.equal(i.deferReply.mock.callCount(), 0);
      assert.equal(i.editReply.mock.callCount(), 0);
    }
  }
});

function mockServices(t, check = () => {}) {
  injectTemplateAssets(t);
  const guarded = (value) => async () => { check(); return structuredClone(value); };
  t.mock.method(api, "getUser", guarded(user));
  t.mock.method(api, "getUserByUsername", guarded(user));
  t.mock.method(api, "getScore", guarded({ ...play, user }));
  t.mock.method(api, "getUserPinnedScores", guarded([play]));
  t.mock.method(api, "getUserMostPlayed", guarded([{ beatmap: map, count: 123 }]));
  t.mock.method(api, "getPerformanceRankings", guarded({ ranking: Array(50).fill({ pp: 6000 }) }));
  t.mock.method(api, "getUserRecentScores", guarded([play]));
  t.mock.method(api, "getUserTopScores", guarded([play]));
  t.mock.method(api, "getBeatmap", guarded({ ...map, max_combo: 500 }));
  t.mock.method(api, "getMatch", guarded({ match: { id: 1, name: "A vs B" }, users: [], events: [] }));
  t.mock.method(db, "getLinkedUser", guarded({ osu_id: 42, default_mode: "osu" }));
  t.mock.method(db, "linkUser", guarded({ osu_id: 42 }));
  t.mock.method(db, "unlinkUser", guarded(true));
}

test("every osu subcommand and alias awaits deferral before option reads or I/O", async (t) => {
  let current;
  mockServices(t, () => current.assertDeferred());
  const values = { username: "Player", pp: 250, beatmap_id_or_url: "12", match_id_or_url: "1", query: "Player", score_id_or_url: "1", target_user: "TargetPlayer", target_pp: 6000, rank: "50" };
  for (const name of ["profile", "recent", "top", "map", "whatif", "bws", "matchcost", "link", "unlink", "avatar", "pinned", "mostplayed", "checkname", "badge", "reach", "rank", "pp", "scorepost"]) {
    current = interaction(name, values);
    await osu.execute(current);
    assert.equal(current.deferReply.mock.callCount(), 1, name);
    assert.ok(current.editReply.mock.callCount() > 0, name);
    const payload = current.editReply.mock.calls[0].arguments[0];
    for (const embed of payload.embeds || []) assert.doesNotThrow(() => embed.toJSON(), name);
    if (!["link", "unlink", "whatif"].includes(name)) assert.ok(payload.embeds?.length, `${name} failed: ${JSON.stringify(payload)}`);
  }
  for (const name of ["rs", "top", "mc", "avatar", "pinned", "mostplayed", "checkname", "badges", "reach", "rank", "pp", "scorepost"]) {
    current = interaction("unused", values);
    await require(`../commands/${name}`).execute(current);
    assert.equal(current.deferReply.mock.callCount(), 1, name);
    assert.ok(current.editReply.mock.calls[0].arguments[0].embeds?.length, name);
  }
});

test("alias execution equals its osu subcommand execution", async (t) => {
  mockServices(t);
  for (const [alias, name] of [["rs", "recent"], ["top", "top"], ["mc", "matchcost"], ...["avatar", "pinned", "mostplayed", "checkname", "reach", "rank", "pp", "scorepost"].map((name) => [name, name]), ["badges", "badge"]]) {
    const values = { username: "Player", match_id_or_url: "1", query: "Player", score_id_or_url: "1", target_user: "TargetPlayer", target_pp: 6000, rank: "50" };
    const normal = interaction(name, values);
    const aliased = interaction("unused", values);
    await osu.execute(normal);
    await require(`../commands/${alias}`).execute(aliased);
    const serialize = (i) => JSON.parse(JSON.stringify(i.editReply.mock.calls[0].arguments[0]));
    assert.deepEqual(serialize(normal), serialize(aliased));
  }
});

test("target precedence: explicit username/ID, mention link, invoking user's link; mode precedence", async (t) => {
  const lookup = t.mock.method(db, "getLinkedUser", async (id) => id === "999"
    ? { osu_id: 99, default_mode: "mania" } : { osu_id: 42, default_mode: "taiko" });
  const i = { user: { id: "123" } };
  assert.deepEqual(await resolveTarget(i, " explicit ", "osu"), { target: "explicit", mode: "osu" });
  assert.deepEqual(await resolveTarget(i, "456"), { target: "456", mode: "taiko" });
  assert.deepEqual(await resolveTarget(i, "<@!999>"), { target: 99, mode: "mania" });
  assert.equal(lookup.mock.calls.at(-1).arguments[0], "999");
  assert.deepEqual(await resolveTarget(i, "<@999>", "fruits"), { target: 99, mode: "fruits" });
  assert.deepEqual(await resolveTarget(i), { target: 42, mode: "taiko" });
  lookup.mock.mockImplementation(async () => null);
  assert.deepEqual(await resolveTarget(i, "name"), { target: "name", mode: "osu" });
  await assert.rejects(resolveTarget(i, "<@999>"), /no linked/);
  await assert.rejects(resolveTarget(i), /Provide an osu! username/);
});

test("recent defaults to include failures, respects false, and starts at a 1-based index", async (t) => {
  mockServices(t);
  api.getUserRecentScores.mock.mockImplementation(async () => [play, { ...play, id: 2 }]);
  const i = interaction("recent", { username: "Player", index: 2 });
  await osu.execute(i);
  assert.deepEqual(api.getUserRecentScores.mock.calls[0].arguments, [42, "osu", true]);
  assert.equal(i.editReply.mock.calls[0].arguments[0].embeds[0].toJSON().url, undefined);
  assert.equal(i.createCollector.mock.callCount(), 0);
  const filtered = interaction("recent", { username: "Player", include_fails: false });
  await osu.execute(filtered);
  assert.deepEqual(api.getUserRecentScores.mock.calls[1].arguments, [42, "osu", false]);
  const invalid = interaction("recent", { username: "Player", index: 3 });
  await osu.execute(invalid);
  assert.match(invalid.editReply.mock.calls[0].arguments[0].content, /between 1 and 2/);
});

test("empty lists, missing targets, missing API config, and 404s produce deferred user feedback", async (t) => {
  mockServices(t);
  api.getUserTopScores.mock.mockImplementation(async () => []);
  const empty = interaction("top", { username: "Player" });
  await osu.execute(empty);
  assert.equal(empty.editReply.mock.calls[0].arguments[0].content, "**`Player` was not found or not enough plays in `Bancho`.**");
  db.getLinkedUser.mock.mockImplementation(async () => null);
  const missing = interaction("profile");
  await osu.execute(missing);
  assert.match(missing.editReply.mock.calls[0].arguments[0].content, /link your account/);
  for (const [error, pattern] of [
    [new Error("osu! API is not configured (OSU_CLIENT_ID and OSU_CLIENT_SECRET)."), /not configured/],
    [Object.assign(new Error("HTTP 404"), { response: { status: 404 } }), /not found/],
    [Object.assign(new Error("HTTP 503"), { response: { status: 503 } }), /unavailable/],
  ]) {
    api.getUser.mock.mockImplementation(async () => { throw error; });
    const i = interaction("profile", { username: "Player" });
    await osu.execute(i);
    assert.match(i.editReply.mock.calls[0].arguments[0].content, pattern);
  }
});

test("link writes only the invoking user's link, with resolved username and chosen default mode", async (t) => {
  mockServices(t);
  const i = interaction("link", { username: "Original", mode: "mania" });
  await osu.execute(i);
  assert.deepEqual(api.getUser.mock.calls[0].arguments, ["Original", "mania"]);
  assert.deepEqual(db.linkUser.mock.calls[0].arguments, ["123", 42, "Player", "mania"]);
  db.linkUser.mock.mockImplementation(async () => null);
  const failed = interaction("link", { username: "Original" });
  await osu.execute(failed);
  assert.match(failed.editReply.mock.calls[0].arguments[0].content, /Could not save/);
  db.unlinkUser.mock.mockImplementation(async () => false);
  const unlink = interaction("unlink");
  await osu.execute(unlink);
  assert.match(unlink.editReply.mock.calls[0].arguments[0].content, /Could not remove/);
  assert.deepEqual(db.unlinkUser.mock.calls[0].arguments, ["123"]);
});

test("pagination rejects other users, authorizes the author, clamps pages and disables controls on timeout", async () => {
  const i = interaction();
  const pages = [new EmbedBuilder().setTitle("One"), new EmbedBuilder().setTitle("Two")];
  await paginate(i, pages);
  assert.deepEqual(i.createCollector.mock.calls[0].arguments[0], { componentType: 2, time: 120_000 });
  const stranger = { user: { id: "other" }, customId: "osu:next", reply: mock.fn(async () => {}), update: mock.fn() };
  i.collector.emit("collect", stranger);
  await tick();
  assert.equal(stranger.reply.mock.calls[0].arguments[0].flags, MessageFlags.Ephemeral);
  assert.equal(stranger.update.mock.callCount(), 0);
  const owner = { user: i.user, customId: "osu:next", update: mock.fn(async () => {}) };
  i.collector.emit("collect", owner);
  await tick();
  const update = owner.update.mock.calls[0].arguments[0];
  assert.equal(update.embeds[0].toJSON().title, "Two");
  assert.equal(update.components[0].toJSON().components[1].disabled, true);
  i.collector.emit("collect", owner);
  await tick();
  assert.equal(owner.update.mock.calls[1].arguments[0].embeds[0].toJSON().title, "Two");
  owner.customId = "osu:prev";
  i.collector.emit("collect", owner);
  await tick();
  assert.equal(owner.update.mock.calls[2].arguments[0].embeds[0].toJSON().title, "One");
  i.collector.emit("end");
  await tick();
  const disabled = i.editReply.mock.calls.at(-1).arguments[0].components[0].toJSON().components;
  assert.ok(disabled.every((button) => button.disabled));
});

test("single-page pagination avoids a collector; deleted replies do not cause unhandled cleanup rejections", async () => {
  const single = interaction();
  await paginate(single, [new EmbedBuilder().setTitle("One")]);
  assert.equal(single.createCollector.mock.callCount(), 0);
  const multiple = interaction();
  await paginate(multiple, [new EmbedBuilder().setTitle("One"), new EmbedBuilder().setTitle("Two")]);
  multiple.editReply.mock.mockImplementation(async () => { throw new Error("Unknown Message"); });
  multiple.collector.emit("end");
  await tick();
});

test("timeout cleanup waits for a pending button update and leaves both controls disabled", async () => {
  const i = interaction();
  await paginate(i, [new EmbedBuilder().setTitle("One"), new EmbedBuilder().setTitle("Two")]);
  let release;
  const owner = { user: i.user, customId: "osu:next", update: mock.fn(() => new Promise((resolve) => { release = resolve; })) };
  i.collector.emit("collect", owner);
  await tick();
  i.collector.emit("end");
  await tick();
  assert.equal(i.editReply.mock.callCount(), 1);
  release();
  await tick();
  assert.ok(i.editReply.mock.calls.at(-1).arguments[0].components[0].toJSON().components.every((button) => button.disabled));
});

test("mapped recent consumes source completion and recomputes accuracy from judgments", async (t) => {
  mockServices(t);
  api.getUserRecentScores.mock.mockImplementation(async () => [{ ...play, failed: true, accuracy: 0.5,
    sourceCalculation: { ...templateCalculation, extra_info: { ...templateCalculation.extra_info, map_completion: 50 } } }]);
  const i = interaction("recent", { username: "Player" });
  await osu.execute(i);
  const embed = payload(i).embeds[0].toJSON();
  assert.equal(embed.description, "▸ **<template-rank-A>** ▸ **245.56PP** (300.12PP for 99.12% FC) ▸ 92.26%\n▸ 123,456 ▸ x400/500 ▸ [100/10/0/2]\n▸ **Map Completion:** 50.00%");
  assert.equal(embed.timestamp, undefined);
  assert.equal(embed.url, undefined);
  assert.equal(i.createCollector.mock.callCount(), 0);
  assert.equal(api.getBeatmap.mock.callCount(), 1);
});

test("mapped recent selects only the requested play without adding controls", async (t) => {
  mockServices(t);
  const scores = [play, { ...play, total_score: 222, sourceCalculation: { ...templateCalculation, extra_info: { ...templateCalculation.extra_info, map_completion: 25 } } }];
  api.getUserRecentScores.mock.mockImplementation(async () => scores);
  const i = interaction("recent", { username: "Player", index: 2 });
  await osu.execute(i);
  assert.equal(payload(i).components, undefined);
  assert.equal(i.createCollector.mock.callCount(), 0);
  assert.equal(payload(i).embeds[0].toJSON().description, "▸ **<template-rank-A>** ▸ **245.56PP** (300.12PP for 99.12% FC) ▸ 92.26%\n▸ 222 ▸ x400/500 ▸ [100/10/0/2]\n▸ **Map Completion:** 25.00%");
});

test("mapped scores omit unified score links for submitted and unsubmitted plays", () => {
  for (const id of [12345, null]) {
    const score = api.normalizeScore({ ...play, id, accuracy: 0.9876 });
    const embed = embeds.scoreEmbed(score, user, templateOptions).toJSON();
    assert.equal(embed.url, undefined);
    assert.equal(embed.author.url, "https://osu.ppy.sh/b/12");
    assert.equal(embed.timestamp, undefined);
  }
});

test("resource parsing supports raw IDs and official difficulty/match URLs, rejecting ambiguous or foreign links", () => {
  for (const input of ["12", "https://osu.ppy.sh/beatmaps/12", "https://osu.ppy.sh/b/12", "https://osu.ppy.sh/beatmapsets/10#osu/12"]) assert.equal(parseResourceId(input, "beatmap"), "12");
  for (const input of ["1", "https://osu.ppy.sh/community/matches/1", "https://osu.ppy.sh/mp/1"]) assert.equal(parseResourceId(input, "match"), "1");
  for (const input of ["0", "-1", "abc", "https://evil.example/beatmaps/12", "https://osu.ppy.sh/beatmapsets/10", "https://osu.ppy.sh/beatmaps/12junk"]) assert.throws(() => parseResourceId(input, "beatmap"), /valid beatmap/);
});

test("unmapped match MVP and history warning remain unchanged", () => {
  const match = embeds.matchCostEmbed({ id: 1, name: "A vs B", gamesPlayed: 3, players: [{ username: "A", matchCost: 2.58, gamesPlayed: 3 }], teamVs: true, teamScore: { red: 2, blue: 1 }, truncated: true }).toJSON();
  assert.match(match.description, /MVP/);
  assert.match(match.description, /Incomplete history:.*500-event/);
});

const payload = (i) => i.editReply.mock.calls[0].arguments[0];
const embedStatus = (i) => payload(i).embeds[0].toJSON().description.split("\n")[0].replaceAll("**", "");

test("score resource parsing supports raw, unified and legacy IDs and rejects invalid/foreign resources", () => {
  for (const input of ["123", "https://osu.ppy.sh/scores/123"]) assert.deepEqual(parseScoreResourceId(input), { id: "123", mode: null });
  for (const mode of ["osu", "taiko", "fruits", "mania"]) assert.deepEqual(parseScoreResourceId(`https://osu.ppy.sh/scores/${mode}/123`), { id: "123", mode });
  for (const input of ["0", "-1", "1.2", "https://evil.example/scores/123", "https://osu.ppy.sh.evil.example/scores/123", "https://osu.ppy.sh/scores/123junk", "https://osu.ppy.sh/scores/catch/123", "https://osu.ppy.sh/scores/mania/0"]) assert.throws(() => parseScoreResourceId(input), /valid score/);
});

test("rank parsing validates country/global ranks and the official API bound", () => {
  for (const input of ["#50", "50", "5000"]) assert.deepEqual(parseRankTarget(input), { rank: Number(input.replace("#", "")), country: null });
  for (const input of ["VN50", "VN#50", "vn50", "US50"]) assert.deepEqual(parseRankTarget(input), { rank: 50, country: input.slice(0, 2).toUpperCase() });
  assert.throws(() => parseRankTarget("10001"), /Ranks beyond #10,000 are not supported/);
  for (const input of ["0", "-1", "1.5", "ZZ50", "V50", "USA50", "VN0"]) assert.throws(() => parseRankTarget(input), /global rank/);
});

test("checkname runs without linked targets and declares absent accounts available only on 404", async (t) => {
  const lookup = t.mock.method(api, "getUserByUsername", async () => { throw Object.assign(new Error("missing"), { response: { status: 404 } }); });
  const links = t.mock.method(db, "getLinkedUser", async () => { throw new Error("must not resolve a linked player"); });
  const profiles = t.mock.method(api, "getUser", async () => { throw new Error("must not resolve a missing player"); });
  const absent = interaction("checkname", { query: "12345" });
  await osu.execute(absent);
  assert.equal(embedStatus(absent), "Available");
  assert.deepEqual(lookup.mock.calls[0].arguments, ["12345", "osu"]);
  assert.equal(links.mock.callCount(), 0);
  assert.equal(profiles.mock.callCount(), 0);
  for (const error of [401, 429, 500, null]) {
    lookup.mock.mockImplementation(async () => { throw error ? Object.assign(new Error(`HTTP ${error}`), { response: { status: error } }) : new Error("Network error"); });
    const failed = interaction("checkname", { query: "Player" });
    await osu.execute(failed);
    assert.equal(payload(failed).embeds, undefined);
    assert.match(payload(failed).content, error ? /API is unavailable/ : /Network error/);
  }
  const before = lookup.mock.callCount();
  const invalid = interaction("checkname", { query: "bad  name" });
  await osu.execute(invalid);
  assert.match(payload(invalid).content, /consecutive spaces/);
  assert.equal(lookup.mock.callCount(), before);
});

test("checkname fetches all four rulesets by resolved ID and fails closed on a single failed fetch", async (t) => {
  t.mock.method(api, "getUserByUsername", async () => ({ ...user, last_visit: "2020-01-01" }));
  const lookup = t.mock.method(api, "getUser", async (_id, mode) => ({ statistics: { play_count: 0 }, rank_highest: { rank: mode === "mania" ? 50 : 500 } }));
  const protectedUser = interaction("checkname", { query: "Player" });
  await osu.execute(protectedUser);
  assert.equal(embedStatus(protectedUser), "Protected indefinitely");
  assert.deepEqual(lookup.mock.calls.map((call) => call.arguments), ["osu", "taiko", "fruits", "mania"].map((mode) => [42, mode]));
  lookup.mock.mockImplementation(async (_id, mode) => {
    if (mode === "fruits") throw Object.assign(new Error("404"), { response: { status: 404 } });
    return { statistics: { play_count: 0 } };
  });
  const unknown = interaction("checkname", { query: "Player" });
  await osu.execute(unknown);
  assert.equal(embedStatus(unknown), "Unknown / Unverified");
});

test("scorepost does not resolve a linked target, forwards legacy mode and enriches beatmap info", async (t) => {
  injectTemplateAssets(t);
  const score = t.mock.method(api, "getScore", async () => ({ ...play, user_id: 42 }));
  const users = t.mock.method(api, "getUser", async () => user);
  const maps = t.mock.method(api, "getBeatmap", async () => ({ ...map, max_combo: 500 }));
  const links = t.mock.method(db, "getLinkedUser", async () => { throw new Error("must not resolve a linked player"); });
  const i = interaction("scorepost", { score_id_or_url: "https://osu.ppy.sh/scores/mania/1" });
  await osu.execute(i);
  assert.deepEqual(score.mock.calls[0].arguments, ["1", "mania"]);
  assert.deepEqual(users.mock.calls[0].arguments, [42, "mania"]);
  assert.deepEqual(maps.mock.calls[0].arguments, [12]);
  assert.equal(links.mock.callCount(), 0);
  const embed = payload(i).embeds[0].toJSON();
  assert.match(embed.description, /```\nPlayer \| Artist - Song \[Insane\] \+HD.*400\/500x.*```/s);
  assert.match(embed.description, /https:\/\/osu.ppy.sh\/scores\/1/);
  assert.equal(embed.fields, undefined);
  assert.match(embed.author.name, /Player • Scorepost • osu!mania/);
});

test("rank maps country and page boundaries to target PP, and rejects missing/out-of-range rankings", async (t) => {
  mockServices(t);
  const ranking = api.getPerformanceRankings;
  ranking.mock.mockImplementation(async () => ({ ranking: Array.from({ length: 50 }, (_, i) => ({ pp: 6000 + i })) }));
  for (const [target, page, index, country] of [["1", 1, 0, null], ["#50", 1, 49, null], ["VN51", 2, 0, "VN"], ["US#10000", 200, 49, "US"]]) {
    const i = interaction("rank", { username: "Player", mode: "mania", rank: target, plays: 2 });
    await osu.execute(i);
    assert.deepEqual(ranking.mock.calls.at(-1).arguments, ["mania", page, country]);
    assert.ok(payload(i).embeds[0].toJSON().description.includes(`Target PP: **${(6000 + index).toLocaleString("en-US")}.00 pp**`));
  }
  const before = ranking.mock.callCount();
  const unsupported = interaction("rank", { username: "Player", rank: "10001" });
  await osu.execute(unsupported);
  assert.equal(payload(unsupported).content, "Ranks beyond #10,000 are not supported by the official osu! rankings API.");
  assert.equal(ranking.mock.callCount(), before);
  for (const response of [{ ranking: [] }, { ranking: [{}] }, {}]) {
    ranking.mock.mockImplementation(async () => response);
    const missing = interaction("rank", { username: "Player", mode: "taiko", rank: "50" });
    await osu.execute(missing);
    assert.equal(payload(missing).content, "Rank #50 not found in taiko rankings.");
  }
});

test("reach and pp forward fixed solver options and reject specifying both", async (t) => {
  mockServices(t);
  api.getUser.mock.mockImplementation(async (target) => target === "TargetPlayer"
    ? { ...user, id: 99, username: "TargetPlayer", statistics: { pp: 6000 } } : user);
  for (const command of ["reach", "pp"]) {
    const target = command === "reach" ? { target_user: "TargetPlayer" } : { target_pp: 6000 };
    const fixed = interaction(command, { username: "Player", ...target, plays: 2 });
    await osu.execute(fixed);
    const description = payload(fixed).embeds[0].toJSON().description;
    assert.match(description, /Required plays: \*\*2\*\*/);
    assert.match(description, /PP per play: \*\*512\.83 pp\*\*/);
    const each = interaction(command, { username: "Player", ...target, each: 1000 });
    await osu.execute(each);
    assert.match(payload(each).embeds[0].toJSON().description, /Required plays: \*\*1\*\*/);
    const both = interaction(command, { username: "Player", ...target, plays: 1, each: 1000 });
    await osu.execute(both);
    assert.equal(payload(both).content, "Specify either `plays` or `each`, not both.");
  }
});

test("osu reach resolves a target player in the subject's ruleset and calculates from subject scores", async (t) => {
  mockServices(t);
  api.getUser.mock.mockImplementation(async (target) => target === "TargetPlayer"
    ? { ...user, id: 99, username: "TargetPlayer", statistics: { pp: 6000 } } : user);
  api.getUserTopScores.mock.mockImplementation(async () => [{ pp: 1000 }]);
  for (const username of [null, "Player"]) {
    const i = interaction("reach", { username, mode: "mania", target_user: "TargetPlayer", plays: 1 });
    await osu.execute(i);
    assert.deepEqual(api.getUser.mock.calls.at(-2).arguments, [username || 42, "mania"]);
    assert.deepEqual(api.getUser.mock.calls.at(-1).arguments, ["TargetPlayer", "mania"]);
    assert.deepEqual(api.getUserTopScores.mock.calls.at(-1).arguments, [42, "mania"]);
    const embed = payload(i).embeds[0].toJSON();
    assert.equal(embed.author.name, "Player • Reach • osu!mania");
    assert.equal(embed.description, [
      "Target player: [TargetPlayer](https://osu.ppy.sh/users/99/mania)",
      "Target PP: **6,000.00 pp**",
      "Required plays: **1** • PP per play: **1,050.00 pp**",
      "Projected total: **6,000.00 pp**",
    ].join("\n"));
  }
});

test("osu reach rejects missing target players and targets with zero or unavailable PP", async (t) => {
  mockServices(t);
  const missing = interaction("reach", { username: "Player" });
  await osu.execute(missing);
  assert.match(payload(missing).content, /Provide a target osu! player/);
  for (const pp of [0, null, undefined]) {
    api.getUser.mock.mockImplementation(async (target) => target === "TargetPlayer"
      ? { ...user, id: 99, username: "TargetPlayer", statistics: { pp } } : user);
    const i = interaction("reach", { username: "Player", target_user: "TargetPlayer" });
    await osu.execute(i);
    assert.match(payload(i).content, /Target player has no PP/);
  }
  assert.equal(api.getUserTopScores.mock.callCount(), 0);
});

test("new display commands paginate pinned scores, 10 maps or 5 badges per page", async (t) => {
  mockServices(t);
  api.getUserPinnedScores.mock.mockImplementation(async () => [play, { ...play, id: 2 }]);
  const pinned = interaction("pinned", { username: "Player", mode: "mania", index: 2 });
  await osu.execute(pinned);
  assert.deepEqual(api.getUserPinnedScores.mock.calls[0].arguments, [42, "mania"]);
    assert.equal(payload(pinned).embeds[0].toJSON().author.name, "Player • Pinned plays • osu!mania");
  assert.match(payload(pinned).embeds[0].toJSON().description, /\*\*2\.\*\*/);
  assert.match(payload(pinned).embeds[0].toJSON().description, /https:\/\/osu.ppy.sh\/scores\/2/);
  const maps = Array.from({ length: 21 }, (_, i) => ({ beatmap: { ...map, id: i + 1 }, count: 100 - i }));
  api.getUserMostPlayed.mock.mockImplementation(async () => maps);
  const most = interaction("mostplayed", { username: "Player" });
  await osu.execute(most);
  assert.equal(payload(most).embeds[0].toJSON().description.match(/\*\*\d+\.\*\*/g).length, 10);
  assert.match(payload(most).embeds[0].toJSON().description, /100 plays.*5\.10★/);
  const button = { user: most.user, customId: "osu:next", update: mock.fn(async () => {}) };
  most.collector.emit("collect", button);
  await tick();
  assert.match(button.update.mock.calls[0].arguments[0].embeds[0].toJSON().description, /^\*\*11\./);
  const badges = Array.from({ length: 11 }, (_, i) => ({ description: `Badge ${i}`, image_url: `https://assets.ppy.sh/badge${i}.png`, awarded_at: "2020-01-01" }));
  api.getUser.mock.mockImplementation(async () => ({ ...user, badges }));
  const badge = interaction("badge", { username: "Player", page: 2 });
  await osu.execute(badge);
  const embed = payload(badge).embeds[0].toJSON();
  assert.equal(payload(badge).embeds.length, 5);
  assert.match(embed.description, /Badge 5/);
  assert.doesNotMatch(embed.description, /Badge 10/);
  for (const [index, badgePage] of payload(badge).embeds.entries()) {
    assert.match(badgePage.toJSON().description, /Awarded <t:/);
    assert.equal(badgePage.toJSON().image.url, `https://assets.ppy.sh/badge${index + 5}.png`);
  }
  assert.equal(embed.image.url, "https://assets.ppy.sh/badge5.png");
  assert.equal(embed.footer.text, "Profile badges • Page 2/3");
  const badgeButton = { user: badge.user, customId: "osu:next", update: mock.fn(async () => {}) };
  badge.collector.emit("collect", badgeButton);
  await tick();
  const lastBadgePage = badgeButton.update.mock.calls[0].arguments[0].embeds;
  assert.equal(lastBadgePage.length, 1);
  assert.match(lastBadgePage[0].toJSON().description, /Badge 10/);
  const avatar = interaction("avatar", { username: "Player", mode: "taiko" });
  await osu.execute(avatar);
  const av = payload(avatar).embeds[0].toJSON();
  assert.equal(av.image.url, user.avatar_url);
  assert.equal(av.author.url, "https://osu.ppy.sh/users/42/taiko");
});

test("empty pinned, most-played and badge lists return useful replies; invalid pages are rejected", async (t) => {
  mockServices(t);
  api.getUserPinnedScores.mock.mockImplementation(async () => []);
  api.getUserMostPlayed.mock.mockImplementation(async () => []);
  const pinned = interaction("pinned", { username: "Player" });
  await osu.execute(pinned);
  assert.match(payload(pinned).content, /No pinned scores/);
  for (const command of ["mostplayed", "badge"]) {
    const empty = interaction(command, { username: "Player" });
    await osu.execute(empty);
    assert.match(payload(empty).embeds[0].toJSON().description, /No .* found/);
    const invalid = interaction(command, { username: "Player", page: 2 });
    await osu.execute(invalid);
    assert.equal(payload(invalid).content, "Choose a page between 1 and 1.");
  }
});

test("unmapped pinned indices select five-entry pages with absolute positions and partial final pages", async (t) => {
  mockServices(t);
  const scores = Array.from({ length: 12 }, (_, index) => ({ ...play, id: index + 1 }));
  api.getUserTopScores.mock.mockImplementation(async () => scores);
  api.getUserPinnedScores.mock.mockImplementation(async () => scores);
  for (const mode of ["osu", "taiko", "fruits", "mania"]) {
    for (const command of ["pinned"]) {
      for (const [index, first, last, page] of [[1, 1, 5, 1], [5, 1, 5, 1], [6, 6, 10, 2], [10, 6, 10, 2], [11, 11, 12, 3], [12, 11, 12, 3]]) {
        const i = interaction(command, { username: "Player", mode, index });
        i.member = { displayColor: 0x2468ac };
        await osu.execute(i);
        const data = payload(i);
        assert.equal(data.embeds.length, 1);
        const embed = data.embeds[0].toJSON();
        assert.equal(embed.color, 0x2468ac);
        assert.equal(embed.author.url, `https://osu.ppy.sh/users/42/${mode}`);
        assert.match(embed.footer.text, new RegExp(`Page ${page}/3 • 12 scores$`));
        const positions = [...embed.description.matchAll(/\*\*(\d+)\.\*\*/g)].map((match) => Number(match[1]));
        assert.deepEqual(positions, Array.from({ length: last - first + 1 }, (_, n) => first + n));
        for (const position of positions) assert.ok(embed.description.includes(`[Score](https://osu.ppy.sh/scores/${position})`));
        const buttons = data.components[0].toJSON().components;
        assert.equal(buttons[0].disabled, page === 1);
        assert.equal(buttons[1].disabled, page === 3);
      }
      const i = interaction(command, { username: "Player", mode, index: 6 });
      await osu.execute(i);
      const owner = { user: i.user, customId: "osu:next", update: mock.fn(async () => {}) };
      i.collector.emit("collect", owner);
      await tick();
      assert.match(owner.update.mock.calls.at(-1).arguments[0].embeds[0].toJSON().description, /^\*\*11\.\*\*/);
      owner.customId = "osu:prev";
      i.collector.emit("collect", owner);
      await tick();
      assert.match(owner.update.mock.calls.at(-1).arguments[0].embeds[0].toJSON().description, /^\*\*6\.\*\*/);
    }
  }
});

test("mapped recent and Number top keep source headers, color and absent controls", async (t) => {
  mockServices(t);
  api.getUserRecentScores.mock.mockImplementation(async () => [play, { ...play, id: 2 }]);
  api.getUserTopScores.mock.mockImplementation(async () => Array(7).fill(play));
  for (const [mode, label] of [["osu", "osu! Standard"], ["taiko", "Taiko"], ["fruits", "Catch the Beat!"], ["mania", "osu! Mania"]]) {
    const i = interaction("recent", { mode, index: 2 });
    i.member = { displayColor: 0x123456 };
    await osu.execute(i);
    assert.equal(payload(i).content, `**Recent ${label} Play for Player:**`);
    assert.equal(payload(i).embeds[0].toJSON().color, 0x123456);
    assert.equal(payload(i).embeds[0].toJSON().url, undefined);
    assert.equal(payload(i).components, undefined);
    assert.equal(i.createCollector.mock.callCount(), 0);
    const top = interaction("top", { mode, index: 6 });
    await osu.execute(top);
    const embed = payload(top).embeds[0].toJSON();
    assert.equal(embed.author.name, `Number 6 ${label} Play for Player`);
    assert.equal(embed.author.url, "https://osu.ppy.sh/users/42");
    assert.equal(embed.footer.text, "On osu! Bancho Server | Page 1 of 1");
    assert.equal(embed.description.split("Score Set").length - 1, 1);
    assert.equal(payload(top).components, undefined);
    assert.equal(top.createCollector.mock.callCount(), 0);
  }
});

test("plain-text what-if, link and unlink payloads retain meaningful results and suppress mentions", async (t) => {
  mockServices(t);
  api.getUserTopScores.mock.mockImplementation(async () => [{ pp: 300 }, { pp: 200 }]);
  const i = interaction("whatif", { username: "Player", mode: "mania", pp: 250 });
  await osu.execute(i);
  assert.deepEqual(payload(i), { content: "**A score of `250.00pp` (`237.50pp` weighted) for `Player` would be their `#2` top play and increase their total to `5,047.50pp` (`+47.50`).**", allowedMentions: { parse: [] } });
  const linked = interaction("link", { username: "Player", mode: "taiko" });
  await osu.execute(linked);
  assert.deepEqual(payload(linked), { content: ":white_check_mark: **Tester, your `Bancho` username has been edited to `Player`**", allowedMentions: { parse: [] } });
  const unlinked = interaction("unlink");
  await osu.execute(unlinked);
  assert.deepEqual(payload(unlinked), { content: ":white_check_mark: **Tester, your `Bancho` username has been removed.**" });
});
