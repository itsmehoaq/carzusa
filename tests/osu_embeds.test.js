const assert = require("node:assert/strict");
const { test } = require("node:test");
const render = require("../utils/osu/embeds");
const { normalizeScore } = require("../utils/osu/osuClient");

const player = {
  id: 42, username: "Player", country_code: "VN", avatar_url: "https://a.ppy.sh/42", is_online: true,
  join_date: "2020-01-01T00:00:00Z",
  statistics: { pp: 5000, global_rank: 1000, country_rank: 10, hit_accuracy: 98.5, play_count: 100,
    level: { current: 100, progress: 25 }, play_time: 7200, ranked_score: 123456, total_score: 987654 },
};
const map = {
  id: 12, user_id: 24, mode: "osu", status: "ranked", cs: 4, ar: 9, accuracy: 8, drain: 6,
  bpm: 180, total_length: 123, difficulty_rating: 5.1, version: "Insane", max_combo: 500,
  beatmapset: { id: 10, artist: "Artist", title: "Song", creator: "Mapper", user_id: 24,
    ranked_date: "2024-02-03T12:00:00Z", favourite_count: 99, covers: { cover: "https://assets.ppy.sh/cover.jpg" } },
};
const play = {
  id: 1, total_score: 123456, accuracy: 98.76, max_combo: 400, mods: ["HD"], rank: "A", pp: 250,
  statistics: { great: 100, ok: 10, meh: 3, miss: 2 }, beatmap: map, failed: false, ended_at: "2026-01-01T00:00:00Z",
};
const modes = [["osu", "osu!"], ["taiko", "osu!taiko"], ["fruits", "osu!catch"], ["mania", "osu!mania"]];
const json = (embed) => JSON.parse(JSON.stringify(embed));
function compact(embed) {
  assert.equal(embed.title, undefined, "player or map author supplies the heading");
  assert.equal(embed.fields, undefined, "description must not be repeated in a field grid");
}

for (const [mode, label] of modes) {
  test(`unmapped avatar and player utility payloads use ${mode} author links and supplied color`, () => {
    const avatar = json(render.avatarEmbed(player, mode, { color: 0x123456 }));
    assert.equal(avatar.author.name, `Player • Avatar • ${label}`);
    assert.equal(avatar.author.url, `https://osu.ppy.sh/users/42/${mode}`);
    assert.equal(avatar.image.url, "https://a.ppy.sh/42");
    assert.equal(avatar.thumbnail, undefined);
    compact(avatar);
    const bws = json(render.bwsEmbed(player, { rank: 1000, bwsRank: 900, badgeCount: 2, adjustment: 10 }, mode, false, { color: 0x123456 }));
    assert.equal(bws.author.name, `Player • Badge-weighted seeding • ${label}`);
    assert.equal(bws.description, "Rank **#1,000** → BWS **#900**\nTournament badges: **2** • Adjustment **10.00%**");
    assert.equal(bws.footer.text, "Tournament badge detection may be inaccurate.");
    compact(bws);
    const reach = json(render.reachEmbed(player, { targetPP: 6000, numPlays: 2, eachPP: 512.83, projectedTotal: 6000.01 }, mode, { id: 99, username: "Target" }, { color: 0x123456 }));
    assert.equal(reach.author.name, `Player • Reach • ${label}`);
    assert.equal(reach.description, `Target player: [Target](https://osu.ppy.sh/users/99/${mode})\nTarget PP: **6,000.00 pp**\nRequired plays: **2** • PP per play: **512.83 pp**\nProjected total: **6,000.01 pp**`);
    assert.equal(reach.footer.text, "Estimate from the top 100; residual PP is preserved without recalculating bonus PP.");
    compact(reach);
    for (const embed of [avatar, bws, reach]) assert.equal(embed.color, 0x123456);
    assert.equal(render.whatIfMessage(player, [{ pp: 300 }, { pp: 200 }], 250), "**A score of `250.00pp` (`237.50pp` weighted) for `Player` would be their `#2` top play and increase their total to `5,047.50pp` (`+47.50`).**");
  });
}

const modeJudgments = {
  osu: "300: 100 / 100: 10 / 50: 3 / Miss: 2",
  taiko: "300: 100 / 150: 10 / Miss: 2",
  fruits: "Fruit: 100 / Drop: 20 / Tiny: 30 / Miss: 2 / Drop miss: 4 / Tiny miss: 5",
  mania: "MAX: 200 / 300: 100 / 200: 7 / 100: 10 / 50: 3 / Miss: 2 • MAX/300: 2.00",
};
for (const [mode, label] of modes) {
  test(`unmapped pinned lists preserve ${mode} judgments, score links and dates`, () => {
    const score = { ...play, statistics: { ...play.statistics, perfect: 200, good: 7, large_tick_hit: 20, small_tick_hit: 30, large_tick_miss: 4, small_tick_miss: 5 } };
    const scores = Array.from({ length: 6 }, (_, i) => ({ ...score, id: i + 1 }));
    for (const [renderer, kind] of [[render.pinnedEmbed, "Pinned"]]) {
      const first = json(renderer(scores, player, { mode, color: 0x123456 }));
      const last = json(renderer(scores, player, { mode, page: 1 }));
      assert.equal(first.author.name, `Player • ${kind} plays • ${label}`);
      assert.equal(first.author.url, `https://osu.ppy.sh/users/42/${mode}`);
      assert.equal(first.author.icon_url, "https://a.ppy.sh/42");
      assert.equal(first.thumbnail.url, "https://a.ppy.sh/42");
      assert.equal(first.color, 0x123456);
      assert.equal(first.description.match(/\*\*\d+\.\*\*/g).length, 5);
      assert.match(first.description, /^\*\*1\.\*\* \[Artist - Song \\\[Insane\\\]\]\(https:\/\/osu.ppy.sh\/beatmaps\/12\)/);
      assert.equal(first.description.split(modeJudgments[mode]).length - 1, 5);
      assert.equal(first.description.match(/Played <t:1767225600:R>/g).length, 5);
      assert.equal(first.footer.text, `${kind} plays • Page 1/2 • 6 scores`);
      assert.match(first.description, /https:\/\/osu.ppy.sh\/scores\/5\)/);
      assert.doesNotMatch(first.description, /https:\/\/osu.ppy.sh\/scores\/6\)/);
      assert.match(last.description, /^\*\*6\.\*\*/);
      assert.equal(last.description.match(/\*\*\d+\.\*\*/g).length, 1);
      assert.equal(last.footer.text, `${kind} plays • Page 2/2 • 6 scores`);
      compact(first);
      compact(last);
    }
  });
}

test("most-played lists and badges preserve player ruleset, absolute positions, links and images", () => {
  const entries = Array.from({ length: 11 }, () => ({ beatmap: map, count: 30 }));
  for (const [mode, label] of modes) {
    const most = json(render.mostPlayedEmbed(player, entries, 1, 2, { mode, color: 0x123456 }));
    assert.equal(most.author.name, `Player • Most played • ${label}`);
    assert.equal(most.description, "**11.** [Artist - Song \\[Insane\\]](https://osu.ppy.sh/beatmaps/12)\n30 plays • 5.10★ • [Download](https://osu.ppy.sh/beatmapsets/10/download)");
    assert.equal(most.footer.text, "Most played • Page 2/2");
    assert.equal(most.thumbnail.url, "https://a.ppy.sh/42");
    compact(most);
    const badge = json(render.badgeEmbed(player, [{ description: "Winner", url: "https://osu.ppy.sh/community/tournaments/1", image_url: "/badge.png", awarded_at: "2020-01-01" }], 0, 1, { mode, color: 0x123456 })[0]);
    assert.equal(badge.author.name, `Player • Profile badges • ${label}`);
    assert.equal(badge.description, "**[Winner](https://osu.ppy.sh/community/tournaments/1)**\nAwarded <t:1577836800:f>");
    assert.equal(badge.image.url, "https://osu.ppy.sh/badge.png");
    assert.equal(badge.footer.text, "Profile badges • Page 1/1");
    assert.equal(badge.color, 0x123456);
    compact(badge);
  }
});

test("BWS overrides, reach solver statuses and rank/PP targets keep results and caveats", () => {
  const bws = json(render.bwsEmbed(player, { rank: 1000, bwsRank: 750, badgeCount: 4, adjustment: 25 }, "osu", true));
  assert.equal(bws.description, "Rank **#1,000** → BWS **#750**\nBadge override: **4** • Adjustment **25.00%**");
  assert.equal(bws.footer.text, "Using your badge override.");
  const already = json(render.reachEmbed(player, { message: "Already reached target PP (5000 >= 4000).", targetPP: 4000, numPlays: 0, eachPP: 0, projectedTotal: 5000 }, "osu", null, { kind: "PP target" }));
  assert.equal(already.author.name, "Player • PP target • osu!");
  assert.match(already.description, /^Already reached target PP \(5000 \\>= 4000\)\./);
  assert.match(already.description, /Required plays: \*\*0\*\* • PP per play: \*\*0\.00 pp\*\*/);
  const rank = json(render.reachEmbed(player, { targetPP: 9000, message: "Target is unreachable within 100 plays and the 50,000 PP per-play bound." }, "mania", null, { kind: "Rank target", targetRank: "VN#50" }));
  assert.equal(rank.author.name, "Player • Rank target • osu!mania");
  assert.match(rank.description, /Target rank: \*\*VN#50\*\*\nTarget PP: \*\*9,000\.00 pp\*\*/);
  assert.match(rank.description, /unreachable within 100 plays and the 50,000 PP per-play bound/);
  assert.doesNotMatch(rank.description, /Required plays/);
  assert.match(rank.footer.text, /residual PP/);
  assert.equal(render.whatIfMessage(player, [{ pp: 300 }], 0), "**This would not be a top play for `Player` and their total pp would not change.**");
});

test("match results remain a ranked list with MVP, teams, absolute positions and truncation caveat", () => {
  const result = { id: 77, name: "A vs B", gamesPlayed: 3, players: Array.from({ length: 16 }, (_, i) => ({ username: `Player ${i + 1}`, team: "red", matchCost: 2.58, gamesPlayed: 2 })), teamVs: true, teamScore: { red: 2, blue: 1 }, truncated: true };
  const first = json(render.matchCostEmbed(result, 0, 15, { color: 0x123456 }));
  assert.deepEqual(first.author, { name: "A vs B", url: "https://osu.ppy.sh/community/matches/77" });
  assert.match(first.description, /^\*\*1\. Player 1\*\* • MVP \(red\) — \*\*2\.58\*\* • 2\/3 maps/);
  assert.match(first.description, /Team score: Red \*\*2\*\* — \*\*1\*\* Blue/);
  assert.match(first.description, /Incomplete history: This match exceeds the 500-event history limit/);
  assert.equal(first.color, 0x123456);
  compact(first);
  const last = json(render.matchCostEmbed(result, 1));
  assert.match(last.description, /^\*\*16\. Player 16\*\*/);
  assert.doesNotMatch(last.description, /MVP/);
  assert.equal(last.footer.text, "3 evaluated maps • Match cost • Page 2/2");
});

test("username availability retains reasons and release dates with safe player heading", () => {
  const embed = json(render.checkNameEmbed({ query: "OldName", status: "Occupied", reasons: ["Inactivity threshold: 180 days across 0 plays.", "Release eligibility is an estimate; manual restrictions may apply."], releaseAt: "2026-01-01T00:00:00Z" }, player));
  assert.equal(embed.author.name, "OldName • Username availability • osu!");
  assert.equal(embed.description, "**Occupied**\nInactivity threshold: 180 days across 0 plays.\nRelease eligibility is an estimate; manual restrictions may apply.\nEligible for release at <t:1767225600:f> (<t:1767225600:R>)");
  compact(embed);
  const absent = json(render.checkNameEmbed({ query: "FreeName", status: "Available", reasons: ["Manual restrictions may apply."] }));
  assert.equal(absent.author.name, "FreeName • Username availability • osu!");
  assert.equal(absent.author.url, undefined);
  assert.equal(absent.description, "**Available**\nManual restrictions may apply.");
});

for (const [mode, label] of modes) {
  test(`scorepost is copyable text with ${mode} player author and no score grid`, () => {
    const embed = json(render.scorepostEmbed(play, player, "Player | Artist - Song [Insane] +HD 250pp", { mode, color: 0x123456 }));
    assert.equal(embed.author.name, `Player • Scorepost • ${label}`);
    assert.ok(embed.description.startsWith("```\nPlayer | Artist - Song [Insane] +HD 250pp\n```\n"));
    assert.ok(embed.description.includes("[Score](https://osu.ppy.sh/scores/1)"));
    assert.ok(embed.description.includes(`${play.total_score.toLocaleString("en-US")} score`));
    assert.match(embed.description, /Played <t:/);
    assert.ok(embed.description.includes("Miss:"));
    assert.equal(embed.thumbnail.url, "https://assets.ppy.sh/cover.jpg");
    compact(embed);
  });
}

test("scorepost preserves failure details and date without duplicating title statistics", () => {
  const failed = { ...play, failed: true, completion: 42 };
  const embed = json(render.scorepostEmbed(failed, player, "Copyable title", { mode: "osu" }));
  assert.match(embed.description, /Failed • 42\.00% completion/);
  assert.match(embed.description, /Played <t:/);
  assert.ok(embed.description.includes(`${play.total_score.toLocaleString("en-US")} score`));
  assert.ok(embed.description.includes("Miss:"));
  assert.doesNotMatch(embed.description, /\d(?:\.\d+)? pp\b|Accuracy|Combo/);
  compact(embed);
});

function withinDiscordLimits(embeds) {
  let total = 0;
  for (const embed of embeds) {
    const data = json(embed);
    assert.ok((data.author?.name.length || 0) <= 256);
    assert.ok((data.title?.length || 0) <= 256);
    assert.ok((data.description?.length || 0) <= 4096);
    assert.ok((data.footer?.text.length || 0) <= 2048);
    total += (data.author?.name.length || 0) + (data.title?.length || 0) + (data.description?.length || 0) + (data.footer?.text.length || 0);
    for (const field of data.fields || []) {
      assert.ok(field.name.length <= 256);
      assert.ok(field.value.length <= 1024);
      total += field.name.length + field.value.length;
    }
    assert.doesNotMatch(JSON.stringify(data), /undefined|NaN|\/beatmaps\/undefined|\/users\/undefined/);
  }
  assert.ok(total <= 6000, `Embed payload has ${total} text characters`);
}

test("missing metadata, malformed images and markdown-heavy names produce bounded valid payloads", () => {
  const emptyUser = { username: "[Name](https://example.com)\n@everyone", avatar_url: "http://[" };
  const missingScore = { accuracy: 0, mods: [{}], beatmap: {}, failed: true, completion: null };
  const empty = [render.avatarEmbed(emptyUser), render.checkNameEmbed({ query: "Name", status: "Unknown", reasons: [], releaseAt: "invalid" }), render.mostPlayedEmbed(emptyUser, [{ count: 0 }]), ...render.badgeEmbed(emptyUser, [{ description: "?", image_url: "javascript:alert(1)" }])];
  for (const embed of empty) withinDiscordLimits([embed]);
  assert.equal(json(empty[0]).description, "Avatar unavailable.");
  const hostile = "[**`Name`**](https://example.com)\n@everyone".repeat(100);
  const longUser = { ...player, username: hostile };
  const longMap = { ...map, version: hostile, beatmapset: { ...map.beatmapset, artist: hostile, title: hostile, creator: hostile } };
  const scores = Array.from({ length: 100 }, (_, i) => ({ ...play, id: i + 1, beatmap: longMap, mods: [{ acronym: hostile }], statistics: { perfect: 1e22, great: 1e22, good: 1e22, ok: 1e22, meh: 1e22, miss: 1e22 }, total_score: 1e22, pp: 1e22, accuracy: 1e22, max_combo: 1e22 }));
  for (const [mode] of modes) {
    withinDiscordLimits([render.pinnedEmbed(scores, longUser, { mode })]);
  }
  withinDiscordLimits([render.mostPlayedEmbed(longUser, scores.map((score) => ({ ...score, count: 1e22 })))]);
  withinDiscordLimits(render.badgeEmbed(longUser, Array.from({ length: 5 }, () => ({ description: hostile, url: "https://osu.ppy.sh/tournament/1" }))));
  withinDiscordLimits([render.checkNameEmbed({ query: hostile, status: hostile, reasons: Array(10).fill(hostile) })]);
  const post = render.scorepostEmbed(play, longUser, hostile);
  withinDiscordLimits([post]);
  assert.equal(json(post).description.match(/```/g).length, 2);
  assert.doesNotMatch(json(post).description.slice(4, -1), /\n@everyone/);
  const escaped = json(render.pinnedEmbed([{ ...play, beatmap: { ...map, beatmapset: { ...map.beatmapset, title: "[x](bad)" } } }], player)).description;
  assert.ok(escaped.includes("\\[x\\](bad)"));
});
