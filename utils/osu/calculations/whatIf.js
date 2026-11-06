function calculateWhatIf(topPlays, newPP, currentTotalPP = 0) {
  if (!Number.isFinite(newPP) || newPP < 0) throw new Error("PP must be a non-negative number.");
  const pp = topPlays.map((play) => Number(typeof play === "number" ? play : play.pp) || 0)
    .sort((a, b) => b - a).slice(0, 100);
  const weighted = (plays) => plays.reduce((sum, value, index) => sum + value * 0.95 ** index, 0);
  const originalWeightedPP = weighted(pp);
  // Insert before equal plays, keeping the hypothetical play on ties.
  const index = pp.findIndex((value) => newPP >= value);
  const insertion = index < 0 ? pp.length : index;
  if (insertion >= 100) return {
    placement: null, projectedWeightedPP: originalWeightedPP, weightedDifference: 0, estimatedTotalPP: currentTotalPP,
  };
  pp.splice(insertion, 0, newPP);
  const projectedWeightedPP = weighted(pp.slice(0, 100));
  const weightedDifference = projectedWeightedPP - originalWeightedPP;
  return { placement: insertion + 1, projectedWeightedPP, weightedDifference, estimatedTotalPP: Number(currentTotalPP) + weightedDifference };
}

module.exports = { calculateWhatIf };
