function createScorepostTitle(score, user = score.user || {}) {
  const map = score.beatmap || {};
  const set = score.beatmapset || map.beatmapset || {};
  const mods = (score.mods || []).map((mod) => typeof mod === "string" ? mod : mod.acronym).filter(Boolean).join("") || "NM";
  const misses = score.statistics?.miss ?? score.statistics?.count_miss ?? 0;
  const decimal = (value) => Number.isFinite(Number(value)) && value != null ? Number(value).toFixed(2) : "?";
  return `${user.username || "Unknown player"} | ${set.artist || "Unknown artist"} - ${set.title || "Unknown title"} [${map.version || "?"}] +${mods} (${set.creator || map.user?.username || "Unknown mapper"}, ${decimal(map.difficulty_rating)}★) ${decimal(score.accuracy)}% ${score.max_combo ?? "?"}/${map.max_combo ?? "?"}x ${misses}xMiss | ${decimal(score.pp)}pp`;
}

module.exports = { createScorepostTitle };
