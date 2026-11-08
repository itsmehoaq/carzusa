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
  status: "ranked",
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

// Template-only injected assets/calculation, not production numeric or asset proof.
const render = require("../utils/osu/embeds");
const template = require("./fixtures/osuPresentation/contracts.json")[0];
sampleMap.sourceCalculation = { ...template.calculation, title: "Song", artist: "Artist", creator: "Mapper", version: "Insane" };
samplePlay.sourceCalculation = sampleMap.sourceCalculation;
function injectTemplateAssets(t) {
  const performance = require("../utils/osu/calculations/performance");
  t.mock.method(performance, "calculate", async () => structuredClone(sampleMap.sourceCalculation));
  t.mock.method(performance, "enrichScore", async (score, beatmap) => ({ ...score, beatmap, sourceCalculation: structuredClone(sampleMap.sourceCalculation) }));
  for (const name of ["scoreEmbed", "scoreListEmbed", "beatmapEmbed", "beatmapMessage"]) {
    const original = render[name];
    t.mock.method(render, name, (value, userOrOptions, options) => name.startsWith("beatmap")
      ? original(value, { ...template.options, ...userOrOptions, rankEmotes: template.options.rankEmotes, diffEmotes: template.options.diffEmotes })
      : original(value, userOrOptions, { ...template.options, ...options, rankEmotes: template.options.rankEmotes, diffEmotes: template.options.diffEmotes }));
  }
}

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
  injectTemplateAssets(t);
  t.mock.method(api, "getUser", async () => sampleUser);
  t.mock.method(api, "getUserRecentScores", async () => [samplePlay]);
  t.mock.method(api, "getBeatmap", async () => sampleMap);
  t.mock.method(db, "getLinkedUser", async () => ({ osu_id: 42, default_mode: "osu" }));

  let sentTyping = false;
  let replySent = null;
  const message = {
    guild: { id: "723867861600174090" },
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

test("Category A prefix aliases select the correct shared handlers and rulesets", () => {
  const groups = {
    avatar: ["avatar", "av", "pfp"], pinned: ["pinned", "pin", "p"], mostplayed: ["mostplayed", "mp"],
    checkname: ["checkname", "cn", "namecheck", "claimname"], badge: ["badge", "badges", "badgelist"],
    reach: ["reach"], rank: ["rank"], pp: ["pp"], scorepost: ["scorepost", "post"],
  };
  for (const [command, aliases] of Object.entries(groups)) {
    for (const alias of aliases) assert.equal(parsePrefixCommand(`>${alias}`).command, command);
  }
  for (const [prefix, mode] of [["t", "taiko"], ["c", "fruits"], ["m", "mania"]]) {
    for (const [suffix, command] of [["pin", "pinned"], ["reach", "reach"], ["rank", "rank"], ["pp", "pp"]]) {
      const parsed = parsePrefixCommand(`>${prefix}${suffix}`);
      assert.equal(parsed.command, command);
      assert.equal(parsed.options.mode, mode);
    }
  }
});

test("new prefix options preserve names, score resources, pagination and solver inputs", () => {
  assert.deepEqual(parsePrefixCommand('>av "A B" -m mania').options, { username: "A B", mode: "mania" });
  assert.equal(parsePrefixCommand(">avatar 12345").options.username, "12345");
  assert.deepEqual(parsePrefixCommand(">tpin peppy 2").options, { username: "peppy", mode: "taiko", index: 2 });
  assert.deepEqual(parsePrefixCommand(">mp peppy --page 2").options, { username: "peppy", mode: null, page: 2 });
  assert.deepEqual(parsePrefixCommand(">badges peppy -p 3").options, { username: "peppy", mode: null, page: 3 });
  assert.deepEqual(parsePrefixCommand(">cn 12345").options, { query: "12345" });
  assert.deepEqual(parsePrefixCommand('>cn "bad  name"').options, { query: "bad  name" });
  assert.deepEqual(parsePrefixCommand('>cn "name "').options, { query: "name " });
  const url = "https://osu.ppy.sh/scores/mania/123";
  assert.deepEqual(parsePrefixCommand(`>post ${url}`).options, { score_id_or_url: url });
  assert.deepEqual(parsePrefixCommand('>treach mrekk "Player Name" --plays 3').options, {
    target_user: "mrekk", username: "Player Name", mode: "taiko", plays: 3, each: null,
  });
  assert.deepEqual(parsePrefixCommand(">crank VN#51 peppy --each 400.5").options, {
    rank: "VN#51", username: "peppy", mode: "fruits", plays: null, each: 400.5,
  });
  assert.deepEqual(parsePrefixCommand(">pp 6000 peppy mania -plays 2 -each 100").options, {
    target_pp: 6000, username: "peppy", mode: "mania", plays: 2, each: 100,
  });
});

test("reach prefix takes the target player first and defaults the subject to the linked account", () => {
  assert.deepEqual(parsePrefixCommand(">reach targetPlayer").options, {
    target_user: "targetPlayer", username: null, mode: null, plays: null, each: null,
  });
  assert.deepEqual(parsePrefixCommand(">reach mrekk WhiteCat").options, {
    target_user: "mrekk", username: "WhiteCat", mode: null, plays: null, each: null,
  });
});

test("prefix page and index flags accept only positive integer tokens", () => {
  for (const command of ["mp", "badges", "recent", "top", "pinned"]) {
    for (const flag of ["--page", "-p", "--index", "-i", "-page", "-index"]) {
      for (const invalid of ["1.5", "1junk", "0", "-1", "01", "1e2", "Infinity", ""]) {
        assert.equal(parsePrefixCommand(`>${command} peppy ${flag} ${invalid}`), null, `${command} ${flag} ${invalid}`);
      }
      const parsed = parsePrefixCommand(`>${command} peppy ${flag} 2`);
      assert.equal(parsed.options.username, "peppy");
      assert.equal(parsed.options[["mp", "badges"].includes(command) ? "page" : "index"], 2);
    }
  }
});

test("new prefix commands execute through shared handlers and malformed solver numbers are rejected", async (t) => {
  t.mock.method(api, "getUser", async (target) => target === "targetPlayer"
    ? { ...sampleUser, id: 99, username: "targetPlayer", statistics: { pp: 6000 } } : sampleUser);
  t.mock.method(api, "getUserTopScores", async () => [samplePlay]);
  t.mock.method(api, "getPerformanceRankings", async () => ({ ranking: Array(50).fill({ pp: 6000 }) }));
  t.mock.method(db, "getLinkedUser", async () => ({ osu_id: 42, default_mode: "osu" }));
  for (const [content, pattern, hasEmbed] of [
    [">av", /Player/, true], [">mreach targetPlayer --plays 2", /Required plays/, true],
    [">rank VN51 --each 1000", /Target PP/, true], [">pp 6000 --plays 1 --each 1000", /Specify either/, false],
    [">reach targetPlayer --plays 1.5", /Plays must be an integer/, false],
    [">reach targetPlayer --plays 1e21", /Plays must be an integer/, false],
    [">pp nope", /valid target_pp/, false], [">reach targetPlayer --each nope", /valid each/, false],
  ]) {
    let reply;
    const message = {
      guild: { id: "723867861600174090" },
      content, author: { id: "123", bot: false }, channel: { sendTyping: async () => {} },
      reply: async (value) => { reply = value; return { createMessageComponentCollector: () => new EventEmitter() }; },
    };
    await osuPrefixEvent.execute(message);
    assert.match(hasEmbed ? JSON.stringify(reply.embeds) : reply.content, pattern, content);
  }
});

test("both command prefixes preserve aliases and ruleset defaults across all displays", () => {
  const groups = [
    ["recent", null, ["rs", "recent", "r"]], ["recent", "mania", ["rsm", "rm", "recentm"]],
    ["recent", "taiko", ["rst", "rt", "recentt"]], ["recent", "fruits", ["rsc", "rc", "recentc"]],
    ["top", null, ["top", "osutop", "best"]], ["top", "mania", ["topm", "bestm"]],
    ["top", "taiko", ["topt", "bestt"]], ["top", "fruits", ["topc", "bestc"]],
    ["profile", null, ["osu", "profile", "user", "u", "me"]],
    ["profile", "mania", ["osum", "maniaprofile"]], ["profile", "taiko", ["osut", "taikoprofile"]],
    ["profile", "fruits", ["osuc", "ctbprofile", "fruitsprofile"]],
    ["map", null, ["map", "m", "beatmap"]], ["whatif", null, ["whatif", "wi"]],
    ["bws", null, ["bws"]], ["matchcost", null, ["mc", "matchcost"]],
    ["link", null, ["link", "set"]], ["unlink", null, ["unlink"]],
    ["avatar", null, ["avatar", "av", "pfp"]], ["pinned", null, ["pinned", "pin", "p"]],
    ["pinned", "taiko", ["tpin"]], ["pinned", "fruits", ["cpin"]], ["pinned", "mania", ["mpin"]],
    ["mostplayed", null, ["mostplayed", "mp"]], ["checkname", null, ["checkname", "cn", "namecheck", "claimname"]],
    ["badge", null, ["badge", "badges", "badgelist"]],
    ["reach", null, ["reach"]], ["reach", "taiko", ["treach"]], ["reach", "fruits", ["creach"]], ["reach", "mania", ["mreach"]],
    ["rank", null, ["rank"]], ["rank", "taiko", ["trank"]], ["rank", "fruits", ["crank"]], ["rank", "mania", ["mrank"]],
    ["pp", null, ["pp"]], ["pp", "taiko", ["tpp"]], ["pp", "fruits", ["cpp"]], ["pp", "mania", ["mpp"]],
    ["scorepost", null, ["scorepost", "post"]],
  ];
  for (const prefix of [">", "<"]) {
    for (const [command, mode, aliases] of groups) {
      for (const alias of aliases) {
        const parsed = parsePrefixCommand(`${prefix}${alias}`);
        assert.equal(parsed.command, command, `${prefix}${alias}`);
        if ("mode" in parsed.options) assert.equal(parsed.options.mode, mode, `${prefix}${alias}`);
      }
    }
  }
});

test("both prefixes route mapped template contracts and unchanged unmapped displays", async (t) => {
  injectTemplateAssets(t);
  t.mock.method(api, "getUser", async (target) => target === "Target"
    ? { ...sampleUser, id: 99, username: "Target", statistics: { pp: 6000 } } : sampleUser);
  t.mock.method(api, "getUserByUsername", async () => sampleUser);
  t.mock.method(api, "getUserRecentScores", async () => [samplePlay, { ...samplePlay, id: 2 }]);
  const scores = Array.from({ length: 7 }, (_, i) => ({ ...samplePlay, id: i + 1 }));
  t.mock.method(api, "getUserTopScores", async () => scores);
  t.mock.method(api, "getUserPinnedScores", async () => scores);
  t.mock.method(api, "getUserMostPlayed", async () => [{ beatmap: sampleMap, count: 50 }]);
  t.mock.method(api, "getPerformanceRankings", async () => ({ ranking: [{ pp: 6000 }] }));
  t.mock.method(api, "getScore", async () => ({ ...samplePlay, user: sampleUser, mode: "mania" }));
  t.mock.method(api, "getBeatmap", async () => sampleMap);
  t.mock.method(api, "getMatch", async () => ({ match: { id: 1, name: "Match" }, users: [], events: [] }));
  t.mock.method(db, "getLinkedUser", async () => ({ osu_id: 42, default_mode: "mania" }));
  t.mock.method(db, "linkUser", async () => true);
  t.mock.method(db, "unlinkUser", async () => true);
  const cases = [
    ["osu", "osu! Mania Profile for Player"], ["rs", "Song [Insane][4k] "], ["top 6", "Number 6 osu! Mania Play for Player"],
    ["map 12", "Artist – Song by Mapper"], ["whatif 250", null, /would be their `#1` top play/],
    ["bws", "Player • Badge-weighted seeding • osu!mania"], ["matchcost 1", "Match"],
    ["link Player mania", null, /your `Bancho` username has been edited to `Player`/], ["unlink", null, /your `Bancho` username has been removed/],
    ["avatar", "Player • Avatar • osu!mania"], ["pinned 6", "Player • Pinned plays • osu!mania"],
    ["mp", "Player • Most played • osu!mania"], ["cn Player", "Player • Username availability • osu!"],
    ["badges", "Player • Profile badges • osu!mania"], ["reach Target", "Player • Reach • osu!mania"],
    ["rank 1", "Player • Rank target • osu!mania"], ["pp 6000", "Player • PP target • osu!mania"],
    ["post 1", "Player • Scorepost • osu!mania"],
  ];
  for (const prefix of [">", "<"]) {
    for (const [command, heading, contentPattern] of cases) {
      let payload;
      const collector = new EventEmitter();
      const message = {
        guild: { id: "723867861600174090" },
        content: `${prefix}${command}`, author: { id: "123", bot: false }, member: { displayColor: 0x13579b },
        channel: { sendTyping: async () => {} },
        reply: async (value) => { payload = value; return { createMessageComponentCollector: () => collector }; },
      };
      await osuPrefixEvent.execute(message);
      assert.deepEqual(payload.allowedMentions, { repliedUser: false, parse: [] });
      if (contentPattern) {
        assert.match(payload.content, contentPattern, message.content);
        assert.equal(payload.embeds, undefined);
      } else {
        const embed = payload.embeds[0].toJSON();
        assert.ok(embed.author.name.startsWith(heading), message.content);
        assert.equal(embed.color, command === "map 12" ? 0x02cc37 : 0x13579b);
      }
      if (command === "pinned 6") {
        assert.match(payload.embeds[0].toJSON().description, /^\*\*6\.\*\*/);
        assert.match(payload.embeds[0].toJSON().footer.text, /Page 2\/2/);
      }
      if (command === "top 6") {
        assert.equal(payload.embeds[0].toJSON().footer.text, "On osu! Bancho Server | Page 1 of 1");
        assert.equal(payload.components, undefined);
      }
      if (command === "rs") {
        assert.equal(payload.content, "**Recent osu! Mania Play for Player:**");
        assert.equal(payload.components, undefined);
        assert.equal(payload.embeds[0].toJSON().timestamp, undefined);
      }
    }
  }
  for (const [alias, mode] of [[">rsm", "mania"], ["<rst", "taiko"], [">rsc", "fruits"], ["<rs -m osu", "osu"]]) {
    const message = { guild: { id: "723867861600174090" }, content: alias, author: { id: "123", bot: false }, channel: { sendTyping: async () => {} }, reply: async () => ({ createMessageComponentCollector: () => new EventEmitter() }) };
    await osuPrefixEvent.execute(message);
    assert.equal(api.getUserRecentScores.mock.calls.at(-1).arguments[1], mode);
  }
});

test("both osu prefixes silently skip other servers and DMs before typing or replying", async () => {
  for (const guild of [{ id: "other-server" }, null, undefined]) {
    for (const content of [">rs", "<rs", ">osu", "<top", ">link Player", "<unlink"]) {
      const message = {
        guild, content, author: { id: "123", bot: false },
        channel: { sendTyping: async () => assert.fail("must not type") },
        reply: async () => assert.fail("must not reply"),
      };
      await osuPrefixEvent.execute(message);
    }
  }
});
