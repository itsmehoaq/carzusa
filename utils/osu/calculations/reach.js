const MAX_PP = 50_000;
const weighted = (plays) => plays.reduce((total, pp, index) => total + pp * 0.95 ** index, 0);

function projection(topScores, currentTotal) {
  const scores = topScores.map((score) => Number(typeof score === "number" ? score : score.pp) || 0)
    .sort((a, b) => b - a).slice(0, 100);
  const residualPP = currentTotal - weighted(scores);
  return (plays) => weighted([...scores, ...plays].sort((a, b) => b - a).slice(0, 100)) + residualPP;
}

function validate(currentTotal, targetPP) {
  if (!Number.isFinite(currentTotal) || currentTotal < 0 || !Number.isFinite(targetPP) || targetPP < 0) {
    throw new Error("Current and target PP must be non-negative finite numbers.");
  }
  if (currentTotal >= targetPP) return {
    status: "already_reached", targetPP, projectedTotal: currentTotal, numPlays: 0, eachPP: 0,
    message: `Already reached target PP (${currentTotal} >= ${targetPP}).`,
  };
  return null;
}

const unreachable = (targetPP) => ({
  status: "unreachable", targetPP, message: "Target is unreachable within 100 plays and the 50,000 PP per-play bound.",
});

function calculateForFixedPlays(topScores, currentTotal, targetPP, numPlays) {
  if (!Number.isInteger(numPlays) || numPlays < 1 || numPlays > 100) throw new Error("Plays must be an integer between 1 and 100.");
  const reached = validate(currentTotal, targetPP);
  if (reached) return reached;
  const project = projection(topScores, currentTotal);
  const best = Number(typeof topScores[0] === "number" ? topScores[0] : topScores[0]?.pp) || 0;
  let low = 0;
  let high = Math.min(MAX_PP, Math.max(targetPP, best) * 1.5);
  while (project(Array(numPlays).fill(high)) < targetPP && high < MAX_PP) high = Math.min(MAX_PP, high * 2);
  if (project(Array(numPlays).fill(high)) < targetPP) return unreachable(targetPP);
  while (high - low > 0.001) {
    const mid = (low + high) / 2;
    if (project(Array(numPlays).fill(mid)) >= targetPP) high = mid;
    else low = mid;
  }
  let eachPP = Math.ceil(high * 100) / 100;
  // The search's upper bound may sit just above an exact cent value.
  const previousCent = Math.round((eachPP - 0.01) * 100) / 100;
  if (previousCent >= 0 && project(Array(numPlays).fill(previousCent)) >= targetPP) eachPP = previousCent;
  return { status: "reachable", targetPP, numPlays, eachPP, projectedTotal: project(Array(numPlays).fill(eachPP)) };
}

function calculateForFixedEach(topScores, currentTotal, targetPP, eachPP) {
  if (!Number.isFinite(eachPP) || eachPP <= 0) throw new Error("PP per play must be a positive finite number.");
  const reached = validate(currentTotal, targetPP);
  if (reached) return reached;
  if (eachPP > MAX_PP) return unreachable(targetPP);
  const project = projection(topScores, currentTotal);
  for (let numPlays = 1; numPlays <= 100; numPlays++) {
    const projectedTotal = project(Array(numPlays).fill(eachPP));
    if (projectedTotal >= targetPP) return { status: "reachable", targetPP, numPlays, eachPP, projectedTotal };
  }
  return unreachable(targetPP);
}

function calculateAuto(topScores, currentTotal, targetPP) {
  const one = calculateForFixedPlays(topScores, currentTotal, targetPP, 1);
  if (one.status === "already_reached") return one;
  const best = Math.max(0, ...topScores.map((score) => Number(typeof score === "number" ? score : score.pp) || 0));
  if (best > 0 && one.status === "reachable" && one.eachPP <= best * 1.25) return one;
  if (best > 0) {
    for (let numPlays = 2; numPlays <= 100; numPlays++) {
      const result = calculateForFixedPlays(topScores, currentTotal, targetPP, numPlays);
      if (result.status === "reachable" && result.eachPP <= best * 1.25) return result;
    }
  }
  // The heuristic must not discard an otherwise valid single-play route.
  if (one.status === "reachable") return one;
  // When one play cannot reach the target, use the smallest reachable play count.
  for (let numPlays = 2; numPlays <= 100; numPlays++) {
    const result = calculateForFixedPlays(topScores, currentTotal, targetPP, numPlays);
    if (result.status === "reachable") return result;
  }
  return one;
}

function calculateReach(topScores, currentTotal, targetPP, { plays = null, each = null } = {}) {
  if (plays !== null && each !== null) throw new Error("Specify either `plays` or `each`, not both.");
  if (plays !== null) return calculateForFixedPlays(topScores, currentTotal, targetPP, plays);
  if (each !== null) return calculateForFixedEach(topScores, currentTotal, targetPP, each);
  return calculateAuto(topScores, currentTotal, targetPP);
}

module.exports = { calculateReach, calculateForFixedPlays, calculateForFixedEach, calculateAuto };
