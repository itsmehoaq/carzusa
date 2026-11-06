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
