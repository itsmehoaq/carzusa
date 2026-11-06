const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { parsePrefixCommand, tokenize, normalizeMode } = require("../utils/osu/prefixParser");
const { createMessageInteraction } = require("../utils/osu/messageInteractionAdapter");
const osuPrefixEvent = require("../events/osuPrefix");
const api = require("../utils/osu/osuClient");
const db = require("../utils/osu/osuDb");

const sampleUser = {
  id: 42,
  username: "Player",
  country_code: "VN",
  avatar_url: "https://a.ppy.sh/42",
  join_date: "2020-01-01T00:00:00Z",
  statistics: {
    pp: 5000,
    global_rank: 1000,
    country_rank: 10,
    hit_accuracy: 98.5,
    play_count: 100,
    level: { current: 100, progress: 25 },
  },
};

const sampleMap = {
  id: 12,
  cs: 4,
  ar: 9,
  accuracy: 8,
  drain: 6,
  bpm: 180,
  total_length: 123,
  difficulty_rating: 5.1,
  version: "Insane",
  beatmapset: {
    id: 10,
    artist: "Artist",
    title: "Song",
    creator: "Mapper",
    covers: { cover: "https://assets.ppy.sh/cover.jpg" },
  },
};

const samplePlay = {
  id: 1,
  total_score: 123456,
  accuracy: 98.76,
  max_combo: 400,
  mods: ["HD"],
  rank: "A",
  pp: 250,
  statistics: { great: 100, ok: 10, miss: 0 },
  beatmap: sampleMap,
  failed: false,
  ended_at: "2026-01-01T00:00:00Z",
};

test("prefixParser rejects non-commands, blockquotes, mentions, and custom emojis", () => {
  assert.equal(parsePrefixCommand(""), null);
  assert.equal(parsePrefixCommand(">"), null);
  assert.equal(parsePrefixCommand("<"), null);
  assert.equal(parsePrefixCommand("> quote block"), null);
  assert.equal(parsePrefixCommand("> text"), null);
  assert.equal(parsePrefixCommand("<:kekw:123456789>"), null);
  assert.equal(parsePrefixCommand("<a:dance:123456789>"), null);
  assert.equal(parsePrefixCommand("<@123456789>"), null);
  assert.equal(parsePrefixCommand("<@!123456789>"), null);
  assert.equal(parsePrefixCommand("<#123456789>"), null);
  assert.equal(parsePrefixCommand("<t:123456789:R>"), null);
  assert.equal(parsePrefixCommand(">>rs"), null);
  assert.equal(parsePrefixCommand("<<rs"), null);
  assert.equal(parsePrefixCommand("->"), null);
  assert.equal(parsePrefixCommand("<3"), null);
  assert.equal(parsePrefixCommand(">notanactualcommand"), null);
  assert.equal(parsePrefixCommand(null), null);
});

test("prefixParser handles recent and top commands with various options", () => {
  // Default recent
  const p1 = parsePrefixCommand(">rs");
  assert.equal(p1.command, "recent");
  assert.equal(p1.options.index, 1);
  assert.equal(p1.options.include_fails, true);
  assert.equal(p1.options.username, null);
  assert.equal(p1.options.mode, null);

  // Alternate prefix <
  const p2 = parsePrefixCommand("<rs 2");
  assert.equal(p2.prefix, "<");
  assert.equal(p2.command, "recent");
  assert.equal(p2.options.index, 2);
  assert.equal(p2.options.include_fails, true);

  // Recent with username and index
  const p3 = parsePrefixCommand(">rs peppy 5");
  assert.equal(p3.command, "recent");
  assert.equal(p3.options.username, "peppy");
  assert.equal(p3.options.index, 5);

  // Recent with index before username
  const p4 = parsePrefixCommand(">rs 3 peppy");
  assert.equal(p4.command, "recent");
  assert.equal(p4.options.username, "peppy");
  assert.equal(p4.options.index, 3);

  // Recent with mode suffix and flag
  const p5 = parsePrefixCommand(">rsm -nf peppy");
  assert.equal(p5.command, "recent");
  assert.equal(p5.options.mode, "mania");
  assert.equal(p5.options.include_fails, false);
  assert.equal(p5.options.username, "peppy");

  // Recent with taiko and fruits suffixes
  assert.equal(parsePrefixCommand(">rst").options.mode, "taiko");
  assert.equal(parsePrefixCommand(">rsc").options.mode, "fruits");

  // Top plays with index
  const p6 = parsePrefixCommand(">top 25");
  assert.equal(p6.command, "top");
  assert.equal(p6.options.index, 25);

  // Top with username and mode flag
  const p7 = parsePrefixCommand(">top WhiteCat 10 -m taiko");
  assert.equal(p7.command, "top");
  assert.equal(p7.options.username, "WhiteCat");
  assert.equal(p7.options.index, 10);
  assert.equal(p7.options.mode, "taiko");
});

test("prefixParser handles profile, bws, whatif, map, matchcost, link, unlink", () => {
  // Profile
  const prof = parsePrefixCommand(">osu WhiteCat");
  assert.equal(prof.command, "profile");
  assert.equal(prof.options.username, "WhiteCat");

  const osum = parsePrefixCommand(">osum");
  assert.equal(osum.command, "profile");
  assert.equal(osum.options.mode, "mania");

  // Whatif
  const wi = parsePrefixCommand(">whatif 750 peppy");
  assert.equal(wi.command, "whatif");
  assert.equal(wi.options.pp, 750);
  assert.equal(wi.options.username, "peppy");

  // BWS
  const bws = parsePrefixCommand(">bws peppy -b 4");
  assert.equal(bws.command, "bws");
  assert.equal(bws.options.badges, 4);
  assert.equal(bws.options.username, "peppy");

  // Map
  const map = parsePrefixCommand(">map 123456");
  assert.equal(map.command, "map");
  assert.equal(map.options.beatmap_id_or_url, "123456");

  // Matchcost
  const mc = parsePrefixCommand(">mc 12345678 -w 2 -s 1 -ez 1.5");
  assert.equal(mc.command, "matchcost");
  assert.equal(mc.options.match_id_or_url, "12345678");
  assert.equal(mc.options.warmups, 2);
  assert.equal(mc.options.skip, 1);
  assert.equal(mc.options.ez, 1.5);

  // Link & unlink
  const link = parsePrefixCommand(">link peppy -m mania");
  assert.equal(link.command, "link");
  assert.equal(link.options.username, "peppy");
  assert.equal(link.options.mode, "mania");

  const linkPos = parsePrefixCommand(">link peppy taiko");
  assert.equal(linkPos.command, "link");
  assert.equal(linkPos.options.username, "peppy");
  assert.equal(linkPos.options.mode, "taiko");

  const unlink = parsePrefixCommand(">unlink");
  assert.equal(unlink.command, "unlink");
});

test("messageInteractionAdapter provides duck-typed interaction methods", async () => {
  let sentTyping = false;
  const replyCalls = [];
  const editCalls = [];

  const fakeMessage = {
    client: {},
    guild: { id: "guild1" },
    channel: {
      sendTyping: async () => { sentTyping = true; },
      send: async () => ({ id: "msg_sent", edit: async () => {} }),
    },
    author: { id: "user123", username: "AuthorUser" },
    member: { id: "user123" },
    reply: async (payload) => {
      replyCalls.push(payload);
      return {
        id: "reply123",
        edit: async (editPayload) => {
          editCalls.push(editPayload);
          return { id: "reply123" };
        },
        createMessageComponentCollector: () => new EventEmitter(),
      };
    },
  };

  const interaction = createMessageInteraction(fakeMessage, "recent", {
    username: "TestUser",
    mode: "osu",
    index: 2,
    include_fails: false,
    ez: 1.5,
  });

  assert.equal(interaction.user.id, "user123");
  assert.equal(interaction.options.getSubcommand(), "recent");
  assert.equal(interaction.options.getString("username"), "TestUser");
  assert.equal(interaction.options.getString("mode"), "osu");
  assert.equal(interaction.options.getInteger("index"), 2);
  assert.equal(interaction.options.getBoolean("include_fails"), false);
  assert.equal(interaction.options.getNumber("ez"), 1.5);

  await interaction.deferReply();
  assert.equal(sentTyping, true);
  assert.equal(interaction.deferred, true);

  await interaction.editReply({ content: "Hello osu!" });
  assert.equal(replyCalls.length, 1);
  assert.equal(replyCalls[0].content, "Hello osu!");
  assert.equal(replyCalls[0].allowedMentions.repliedUser, false);
  assert.equal(interaction.replied, true);

  await interaction.editReply({ content: "Updated osu!" });
  assert.equal(editCalls.length, 1);
  assert.equal(editCalls[0].content, "Updated osu!");
});

test("osuPrefix event executes commands end-to-end and replies without ping", async (t) => {
  t.mock.method(api, "getUser", async () => sampleUser);
  t.mock.method(api, "getUserRecentScores", async () => [samplePlay]);
  t.mock.method(api, "getBeatmap", async () => sampleMap);
  t.mock.method(db, "getLinkedUser", async () => ({ osu_id: 42, default_mode: "osu" }));

  let sentTyping = false;
  let replySent = null;
  const message = {
    content: ">rs",
    author: { id: "user456", bot: false },
    channel: {
      sendTyping: async () => { sentTyping = true; },
    },
    reply: async (payload) => {
      replySent = payload;
      return {
        id: "rep1",
        edit: async (p) => p,
        createMessageComponentCollector: () => new EventEmitter(),
      };
    },
  };

  // Non-bot command
  await osuPrefixEvent.execute(message);
  assert.equal(sentTyping, true);
  assert.ok(replySent);
  assert.equal(replySent.allowedMentions.repliedUser, false);
  assert.ok(replySent.embeds && replySent.embeds.length > 0);

  // Bot message ignored
  let botReplied = false;
  const botMessage = {
    content: ">rs",
    author: { id: "bot123", bot: true },
    reply: async () => { botReplied = true; },
  };
  await osuPrefixEvent.execute(botMessage);
  assert.equal(botReplied, false);
});
