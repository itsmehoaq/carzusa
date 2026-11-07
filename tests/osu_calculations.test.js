const assert = require("node:assert/strict");
const { test } = require("node:test");
const { calculateWhatIf } = require("../utils/osu/calculations/whatIf");
const { calculateBws, isTournamentBadge } = require("../utils/osu/calculations/bws");
const { evaluateMatchCost } = require("../utils/osu/calculations/matchCost");

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("what-if inserts a play with decaying weights and preserves the existing total's bonus PP", () => {
  const result = calculateWhatIf([300, 200, 100], 250, 5000);
  assert.equal(result.placement, 2);
  close(result.projectedWeightedPP, 803.7375);
  close(result.weightedDifference, 223.4875);
  assert.equal(result.estimatedTotalPP.toFixed(2), "5223.49");
  assert.deepEqual(calculateWhatIf([], 400), { placement: 1, projectedWeightedPP: 400, weightedDifference: 400, estimatedTotalPP: 400 });
});

test("what-if prefers a new play on ties, evicts #100, and reports no change outside top 100", () => {
  const plays = Array.from({ length: 100 }, (_, i) => ({ pp: 200 - i }));
  const snapshot = structuredClone(plays);
  const outside = calculateWhatIf(plays, 100, 9999);
  assert.equal(outside.placement, null);
  assert.equal(outside.weightedDifference, 0);
  assert.equal(outside.estimatedTotalPP, 9999);
  assert.equal(calculateWhatIf(plays, 101).placement, 100);
  assert.equal(calculateWhatIf(plays, 200).placement, 1);
  const newBest = calculateWhatIf(plays, 300);
  const expected = 300 + plays.slice(0, 99).reduce((n, play, index) => n + play.pp * 0.95 ** (index + 1), 0);
  close(newBest.projectedWeightedPP, expected);
  assert.deepEqual(plays, snapshot);
  assert.throws(() => calculateWhatIf([], -1), /non-negative/);
  assert.throws(() => calculateWhatIf([], NaN), /non-negative/);
});

test("BWS numerical fixtures and invalid/unranked ranks", () => {
  assert.equal(calculateBws(1000, [], "osu", 0).bwsRank, 1000);
  assert.equal(calculateBws(1000, [], "osu", 3).bwsRank, 683);
  assert.equal(calculateBws(1000, [], "osu", 5).bwsRank, 364);
  for (const rank of [null, 0, -1, undefined]) assert.equal(calculateBws(rank, [], "osu", 3).bwsRank, 0);
  assert.equal(calculateBws(1000, [], "osu", -5).badgeCount, 0);
  assert.equal(calculateBws(1000, [], "osu", 101).badgeCount, 100);
});

test("BWS excludes contribution/art/mapping badges, matches rulesets, and allows unspecified tournaments", () => {
  const badges = [
    { description: "osu! World Cup 2025 champion", url: "https://osu.ppy.sh/wiki/Tournaments/OWC/2025" },
    { description: "osu!mania 4K World Cup winner" },
    { description: "osu!taiko tournament champion" },
    { description: "osu!catch 1st place" },
    { description: "Summer Cup", url: "https://osu.ppy.sh/community/tournaments/1" },
    { description: "Winner of the mapping contest" },
    { description: "Fanart contest winner" },
    { description: "Spotlight champion" },
    { description: "Beatmap nominator" },
    { description: "Community contributor", url: "https://osu.ppy.sh/community/tournaments/2" },
  ];
  assert.equal(calculateBws(1000, badges, "osu").badgeCount, 2);
  for (const mode of ["mania", "taiko", "fruits"]) assert.equal(calculateBws(1000, badges, mode).badgeCount, 2);
  assert.equal(isTournamentBadge({ description: "Unknown badge" }), false);
});

const users = [{ id: 1, username: "User A" }, { id: 2, username: "User B" }];
const game = (id, scores) => ({ id, startedAt: new Date(id * 1000), scores });
const score = (userID, value, team, easy = false) => ({ userID, score: value, team, easy });

test("three-game match fixture with warmups=0, skip=0, ez=1.78 displays 2.58 for User A", () => {
  const match = { users, teamVs: false, ended: true, games: [
    game(1, [score(1, 100000, undefined, true), score(2, 91000)]),
    game(2, [score(1, 178000), score(2, 91000)]),
    game(3, [score(1, 100000, undefined, true), score(2, 91000)]),
  ] };
  const result = evaluateMatchCost(match, { warmups: 0, skip: 0, ez: 1.78 });
  assert.equal(result.players[0].username, "User A");
  assert.equal(result.players[0].matchCost.toFixed(2), "2.58");
  assert.equal(result.gamesPlayed, 3);
  assert.deepEqual(result.teamScore, { red: 3, blue: 0 });
});

test("team impact boosts only the above-average portion, with neutral prior weight 2", () => {
  const result = evaluateMatchCost({ users, teamVs: true, games: [game(1, [score(1, 600, "red"), score(2, 400, "blue")])] });
  // A ratio=1.2; criticality=400/600; impact=.2*(2/3)*.3=.04.
  close(result.players[0].matchCost, 2.24);
  close(result.players[1].matchCost, 1.8);
  assert.deepEqual(result.teamScore, { red: 1, blue: 0 });
});

test("tiebreaker detection precedes skip trimming, so the previous game gains no retroactive weight", () => {
  const match = { users, teamVs: true, ended: true, games: [
    game(1, [score(1, 600, "red"), score(2, 400, "blue")]),
    game(2, [score(1, 400, "red"), score(2, 600, "blue")]),
    game(3, [score(1, 700, "red"), score(2, 300, "blue")]),
  ] };
  const skipped = evaluateMatchCost(match, { skip: 1 });
  const ongoing = evaluateMatchCost({ ...match, ended: false }, { skip: 1 });
  assert.deepEqual(skipped, ongoing);
  const complete = evaluateMatchCost(match);
  // A map contributions: 1.24, .8, (1.4 + .4*(3/7)*.3)*1.15.
  close(complete.players.find((p) => p.userID === 1).matchCost, 2 + ((1.24 + 0.8 + (1.4 + 0.4 * 3 / 7 * 0.3) * 1.15 + 2) / 5.15 - 1) * 3);
  assert.deepEqual(complete.teamScore, { red: 2, blue: 1 });
});

test("warmups, ineligible games, participation, and zero display clamp", () => {
  const match = { users: [...users, { id: 3, username: "Sub" }], teamVs: false, games: [
    game(1, [score(1, 999999), score(2, 1)]),
    game(2, [score(1, 100), score(2, 100)]),
    game(3, [score(1, 100), score(2, 100), score(3, 100)]),
    game(4, [score(1, 999)]),
    game(5, [score(1, 0), score(2, 0)]),
  ] };
  const result = evaluateMatchCost(match, { warmups: 1 });
  assert.equal(result.gamesPlayed, 2);
  close(result.players.find((p) => p.userID === 1).matchCost, 2);
  close(result.players.find((p) => p.userID === 3).matchCost, 1.85);
  const low = evaluateMatchCost({ users, games: Array.from({ length: 10 }, (_, index) => game(index, [score(1, 0), score(2, 100)])) });
  assert.equal(low.players.find((p) => p.userID === 1).matchCost, 0);
  assert.deepEqual(evaluateMatchCost({ users, games: [] }).players, []);
});

test("raw match adapter skips unfinished games, accepts mixed mod representations, and warns above 500 events", () => {
  const result = evaluateMatchCost({
    match: { id: 1, name: "Test match", end_time: "2026-01-01" }, users,
    events: [
      { id: 1, game: { id: 1, start_time: "2026-01-01", end_time: "2026-01-01", team_type: "team-vs", scores: [
        { user_id: 1, total_score: 1000, mods: [{ acronym: "EZ" }], match: { team: "red" } },
        { user_id: 2, legacy_total_score: 900, mods: ["HD"], match: { team: "blue" } },
      ] } },
      { id: 2, game: { id: 2, scores: [] } },
      ...Array.from({ length: 500 }, (_, index) => ({ id: index + 3 })),
    ],
  });
  assert.equal(result.gamesPlayed, 1);
  assert.equal(result.teamVs, true);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.teamScore, { red: 1, blue: 0 });
});

const { calculateReach, calculateForFixedPlays, calculateForFixedEach, calculateAuto } = require("../utils/osu/calculations/reach");
const { validateUsername, calculateNameAvailability } = require("../utils/osu/calculations/nameAvailability");
const { createScorepostTitle } = require("../utils/osu/calculations/scorepost");
const weightedPP = (values) => values.reduce((sum, pp, index) => sum + pp * 0.95 ** index, 0);

test("reach preserves residual PP, evicts at 100, rounds upward, and leaves inputs intact", () => {
  const scores = Array.from({ length: 100 }, (_, i) => ({ pp: 300 - i * 2 }));
  const snapshot = structuredClone(scores);
  const currentTotal = weightedPP(scores.map((s) => s.pp)) + 1234;
  const result = calculateForFixedPlays(scores, currentTotal, currentTotal + 500, 3);
  const merged = [...scores.map((s) => s.pp), ...Array(3).fill(result.eachPP)].sort((a, b) => b - a).slice(0, 100);
  close(result.projectedTotal, weightedPP(merged) + 1234);
  assert.ok(result.projectedTotal >= currentTotal + 500);
  const smaller = [...scores.map((s) => s.pp), ...Array(3).fill(result.eachPP - 0.01)].sort((a, b) => b - a).slice(0, 100);
  assert.ok(weightedPP(smaller) + 1234 < currentTotal + 500);
  assert.deepEqual(scores, snapshot);
  assert.equal(calculateForFixedPlays([], 10, 160, 1).eachPP, 150);
  assert.equal(calculateForFixedPlays([], 10, 160.001, 1).eachPP, 150.01);
  assert.equal(calculateForFixedPlays([{ pp: 1 }], 100, 500, 10).status, "reachable");
});

test("reach handles fixed-each minimal counts, auto selection, reached targets and bounds", () => {
  const each = calculateForFixedEach([], 50, 240, 100);
  assert.equal(each.numPlays, 2);
  close(each.projectedTotal, 245);
  assert.equal(calculateForFixedEach(Array(100).fill({ pp: 200 }), 5000, 5001, 100).status, "unreachable");
  assert.equal(calculateAuto([{ pp: 200 }], 1000, 1050).numPlays, 1);
  const auto = calculateAuto([{ pp: 200 }], 1000, 1400);
  assert.equal(auto.numPlays, 2);
  assert.ok(calculateForFixedPlays([{ pp: 200 }], 1000, 1400, 1).eachPP > 250);
  assert.ok(auto.eachPP <= 250);
  assert.equal(calculateAuto([], 0, 100).eachPP, 100);
  assert.equal(calculateForFixedPlays([], 0, 50000, 1).eachPP, 50000);
  assert.equal(calculateForFixedPlays([], 0, 50001, 1).status, "unreachable");
  assert.equal(calculateForFixedPlays([], 0, 1e9, 100).status, "unreachable");
  assert.equal(calculateForFixedEach([], 0, 1e9, 50000).status, "unreachable");
  assert.equal(calculateReach([], 100, 99).message, "Already reached target PP (100 >= 99).");
  assert.throws(() => calculateReach([], 0, 100, { plays: 2, each: 100 }), /Specify either `plays` or `each`, not both/);
  for (const plays of [0, -1, 101, 1.5, NaN]) assert.throws(() => calculateForFixedPlays([], 0, 100, plays), /integer/);
  for (const pp of [NaN, -1, Infinity]) assert.throws(() => calculateReach([], 0, pp), /finite/);
  assert.throws(() => calculateForFixedEach([], 0, 100, 0), /positive/);
});

test("auto reach keeps the valid single-play route when no multi-play route meets the heuristic", () => {
  const result = calculateAuto([100], 100, 3000);
  assert.equal(result.status, "reachable");
  assert.equal(result.numPlays, 1);
  assert.equal(result.eachPP, 2905);
  assert.equal(result.projectedTotal, 3000);
  assert.deepEqual(calculateReach([100], 100, 3000), result);
});

test("auto reach finds a two-play route when one play cannot reach a high target", () => {
  const result = calculateAuto([100], 100, 60000);
  assert.equal(result.status, "reachable");
  assert.equal(result.numPlays, 2);
  assert.ok(result.eachPP <= 50000);
  assert.ok(result.projectedTotal >= 60000);
});

test("auto reach finds a two-play route without an existing best play", () => {
  const result = calculateAuto([], 0, 50001);
  assert.equal(result.status, "reachable");
  assert.equal(result.numPlays, 2);
  assert.ok(result.eachPP <= 50000);
  assert.ok(result.projectedTotal >= 50001);
});

test("username validation enforces character, spacing, and length rules", () => {
  for (const name of ["abc", "12345", "[peppy]", "name-here", "name_here", "name here", "a".repeat(15)]) assert.equal(validateUsername(name).valid, true, name);
  for (const name of [null, "ab", "a".repeat(16), "a.b", "éabc", " abc", "abc ", "ab  cd", "ab_cd ef", "ab\tcd", "ab\ncd"]) assert.equal(validateUsername(name).valid, false, String(name));
});

const profiles = (plays = 0) => Array.from({ length: 4 }, () => ({ statistics: { play_count: plays } }));
const inactiveUser = { username: "Current", last_visit: "2020-01-01T00:00:00Z" };
test("name availability uses all four playcounts, threshold boundary and private activity", () => {
  const last = Date.parse(inactiveUser.last_visit);
  const total = 4 * 1000;
  const days = Math.floor(180 + 1580 * (1 - Math.exp(-total / 5900)) + total * 8 / 5900);
  const occupied = calculateNameAvailability("Current", inactiveUser, profiles(1000), last + days * 86400000 - 1);
  assert.equal(occupied.status, "Occupied");
  assert.equal(occupied.thresholdDays, days);
  assert.equal(calculateNameAvailability("Current", inactiveUser, profiles(1000), Date.parse(occupied.releaseAt)).status, "Eligible for release due to inactivity");
  assert.equal(calculateNameAvailability("Current", { last_visit: null }, profiles()).status, "Unknown / Private Activity");
  assert.equal(calculateNameAvailability("Current", { last_visit: "invalid" }, profiles()).status, "Unknown / Private Activity");
  assert.equal(calculateNameAvailability("Current", inactiveUser, null).status, "Unknown / Unverified");
  assert.equal(calculateNameAvailability("Absent", null).status, "Available");
});

test("name availability protects historical ranks in any ruleset, mappers, badges and former names", () => {
  for (let i = 0; i < 4; i++) {
    const all = profiles();
    all[i].rank_highest = { rank: 100 };
    assert.equal(calculateNameAvailability("Current", inactiveUser, all).status, "Protected indefinitely");
  }
  for (const key of ["ranked_beatmapset_count", "ranked_and_approved_beatmapset_count", "loved_beatmapset_count", "guest_beatmapset_count"]) {
    assert.equal(calculateNameAvailability("Current", { ...inactiveUser, [key]: 1 }, profiles()).status, "Protected indefinitely");
  }
  assert.equal(calculateNameAvailability("Current", { ...inactiveUser, badges: [{}] }, profiles()).status, "Protected indefinitely");
  const former = calculateNameAvailability("oldname", { ...inactiveUser, previous_usernames: ["OldName"] }, profiles());
  assert.equal(former.status, "Former username");
  assert.match(former.reasons[0], /Former username of active player Current.*Renamed date is unverified/);
});

test("scorepost formats normalized score metadata into a standard r/osugame title", () => {
  const score = { accuracy: 99.12, max_combo: 900, mods: ["HD", "HR"], pp: 456.789, statistics: { miss: 2 },
    beatmap: { version: "Insane", difficulty_rating: 6.123, max_combo: 1000 }, beatmapset: { artist: "Artist", title: "Title", creator: "Mapper" } };
  assert.equal(createScorepostTitle(score, { username: "Player" }), "Player | Artist - Title [Insane] +HDHR (Mapper, 6.12★) 99.12% 900/1000x 2xMiss | 456.79pp");
  assert.match(createScorepostTitle({ ...score, pp: null, mods: [], statistics: { count_miss: 0 } }), /\+NM.*0xMiss \| \?pp/);
});
