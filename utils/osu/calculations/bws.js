const EXCLUDED = /mapping|mapper|map(?:ping)? contest|fan\s?art|spotlight|beatmap|skin(?:ning)?|storyboard|contribut|moderator|nomination|community choice|aspire|art contest/i;
const TOURNAMENT = /tournament|world cup|champion|winner|\b1st\b|first place|\b(?:owc|twc|cwc|mwc)\b/i;

function isTournamentBadge(badge, mode = "osu") {
  const description = badge.description || "";
  const url = badge.url || "";
  if (EXCLUDED.test(description)) return false;
  if (!/\/tournaments\//i.test(url) && !TOURNAMENT.test(description)) return false;
  const text = `${description} ${url}`;
  const mentionedModes = [];
  if (/standard|osu!?(?:standard|std)|\bstd\b|\bowc\b|osu! world cup|\/tournaments\/owc/i.test(text)) mentionedModes.push("osu");
  if (/taiko|\btwc\b/i.test(text)) mentionedModes.push("taiko");
  if (/catch|fruits|\bcwc\b|\bctb\b/i.test(text)) mentionedModes.push("fruits");
  if (/mania|\bmwc\b/i.test(text)) mentionedModes.push("mania");
  return mentionedModes.length === 0 || mentionedModes.includes(mode);
}

function calculateBws(rank, badges = [], mode = "osu", override = null) {
  const badgeCount = override === null || override === undefined
    ? badges.filter((badge) => isTournamentBadge(badge, mode)).length
    : Math.max(0, Math.min(100, Math.trunc(Number(override) || 0)));
  const validRank = Number.isFinite(Number(rank)) && Number(rank) > 0 ? Number(rank) : 0;
  const bwsRank = validRank ? Math.round(validRank ** (0.9937 ** (badgeCount ** 2))) : 0;
  return { rank: validRank, badgeCount, bwsRank, adjustment: validRank ? (1 - bwsRank / validRank) * 100 : 0 };
}

module.exports = { calculateBws, isTournamentBadge };
