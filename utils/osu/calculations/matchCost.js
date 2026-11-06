// Port of Gurabot's MatchCostEvaluator.service.ts, with an osu! v2 payload adapter.
function normalizeMatch(payload) {
  if (payload.games) return payload;
  const events = payload.events || [];
  return {
    id: payload.match?.id,
    name: payload.match?.name || "osu! match",
    ended: Boolean(payload.match?.end_time),
    teamVs: events.some((event) => event.game?.team_type === "team-vs"),
    users: payload.users || [],
    games: events.filter((event) => event.game?.end_time).map(({ game }) => ({
      id: game.id,
      startedAt: game.start_time,
      scores: game.scores.map((score) => ({
        userID: score.user_id,
        score: Number(score.total_score ?? score.legacy_total_score ?? score.score) || 0,
        easy: (score.mods || []).some((mod) => (typeof mod === "string" ? mod : mod.acronym) === "EZ"),
        team: ["red", "blue"].includes(score.match?.team) ? score.match.team : undefined,
      })),
    })),
    truncated: payload.truncated || events.length > 500,
  };
}

function evaluateMatchCost(payload, { warmups = 0, skip = 0, ez = 1.78 } = {}) {
  const match = normalizeMatch(payload);
  const adjusted = (score) => score.easy ? score.score * ez : score.score;
  function winner(game) {
    let red = 0;
    let blue = 0;
    let hasRed = false;
    let hasBlue = false;
    for (const score of game.scores) {
      if (score.team === "red") { red += adjusted(score); hasRed = true; }
      if (score.team === "blue") { blue += adjusted(score); hasBlue = true; }
    }
    if (!hasRed || !hasBlue || red === blue) return undefined;
    return red > blue ? "red" : "blue";
  }
  function teamScore(games) {
    const result = { red: 0, blue: 0 };
    for (const game of games) {
      const team = winner(game);
      if (team) result[team]++;
    }
    return result;
  }
  function criticality(score, game) {
    const own = game.scores.filter((item) => item.team === score.team).reduce((n, item) => n + adjusted(item), 0);
    const opponent = game.scores.filter((item) => item.team && item.team !== score.team).reduce((n, item) => n + adjusted(item), 0);
    const value = adjusted(score);
    if (own <= opponent || value <= 0 || own - value > opponent) return 0;
    return Math.min(1, Math.max(0, (opponent - (own - value)) / value));
  }

  const afterWarmups = [...match.games].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
    .slice(Math.max(0, Math.trunc(warmups)));
  // Detect against the full competitive series BEFORE trimming maps from its end.
  let tiebreakerID;
  if (match.teamVs && match.ended && afterWarmups.length >= 2) {
    const beforeFinal = teamScore(afterWarmups.slice(0, -1));
    if (beforeFinal.red > 0 && beforeFinal.red === beforeFinal.blue && winner(afterWarmups.at(-1))) {
      tiebreakerID = afterWarmups.at(-1).id;
    }
  }
  const games = skip > 0 ? afterWarmups.slice(0, -Math.trunc(skip)) : afterWarmups;
  const accumulators = new Map();
  let totalGames = 0;
  for (const game of games) {
    if (game.scores.length < 2) continue;
    const average = game.scores.reduce((n, score) => n + adjusted(score), 0) / game.scores.length;
    if (average <= 0) continue;
    totalGames++;
    const weight = game.id === tiebreakerID ? 1.15 : 1;
    const winningTeam = match.teamVs ? winner(game) : undefined;
    for (const score of game.scores) {
      const entry = accumulators.get(score.userID) || { weightedRatioSum: 0, totalWeight: 0, gamesPlayed: 0, teams: new Map() };
      const ratio = adjusted(score) / average;
      const impact = score.team && score.team === winningTeam && ratio > 1 ? criticality(score, game) : 0;
      entry.weightedRatioSum += (ratio + Math.max(0, ratio - 1) * impact * 0.3) * weight;
      entry.totalWeight += weight;
      entry.gamesPlayed++;
      if (score.team) entry.teams.set(score.team, (entry.teams.get(score.team) || 0) + 1);
      accumulators.set(score.userID, entry);
    }
  }
  const players = [];
  for (const user of match.users) {
    const entry = accumulators.get(user.id);
    if (!entry?.gamesPlayed || !entry.totalWeight) continue;
    const confidenceAdjusted = (entry.weightedRatioSum + 2) / (entry.totalWeight + 2);
    const rawCost = confidenceAdjusted * (0.9 + 0.1 * entry.gamesPlayed / totalGames);
    const team = [...entry.teams.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    players.push({
      userID: user.id, username: user.username, countryCode: user.country_code ?? user.countryCode,
      matchCost: Math.max(0, 2 + (rawCost - 1) * 3), gamesPlayed: entry.gamesPlayed, team,
    });
  }
  players.sort((a, b) => b.matchCost - a.matchCost);

  // Gurabot also presents a two-player head-to-head lobby with a team scoreboard.
  let scoreGames = games;
  let teamVs = match.teamVs;
  const ids = [...new Set(match.games.flatMap((game) => game.scores.map((score) => score.userID)))].sort((a, b) => a - b);
  if (!teamVs && players.length === 2 && ids.length === 2) {
    teamVs = true;
    const team = (id) => id === ids[0] ? "red" : "blue";
    for (const player of players) player.team = team(player.userID);
    scoreGames = games.filter((game) => game.scores.length === 2).map((game) => ({
      ...game, scores: game.scores.map((score) => ({ ...score, team: team(score.userID) })),
    }));
  }
  return {
    name: match.name, id: match.id, teamVs, gamesPlayed: totalGames, players,
    teamScore: teamVs ? teamScore(scoreGames) : undefined,
    truncated: Boolean(match.truncated),
  };
}

module.exports = { evaluateMatchCost, normalizeMatch };
