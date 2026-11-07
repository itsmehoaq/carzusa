function validateUsername(query) {
  if (typeof query !== "string" || query.length < 3 || query.length > 15) return { valid: false, reason: "Usernames must be between 3 and 15 characters." };
  if (!/^[A-Za-z0-9_[\] -]+$/.test(query)) return { valid: false, reason: "Use only letters, numbers, underscores, brackets, spaces, and hyphens." };
  if (query !== query.trim() || / {2}/.test(query) || query.includes(" ") && query.includes("_")) {
    return { valid: false, reason: "Usernames cannot have leading/trailing spaces, consecutive spaces, or mix spaces and underscores." };
  }
  return { valid: true };
}

function calculateNameAvailability(query, user, profiles, now = Date.now()) {
  if (!user) return {
    query, status: "Available", reasons: ["No active account found. May be available unless subject to manual restrictions or offensive word blacklists."],
  };
  if (!profiles || profiles.length !== 4 || profiles.some((profile) => !profile)) return {
    query, status: "Unknown / Unverified", reasons: ["Could not verify all four ruleset profiles."],
  };
  const reasons = [];
  if (user.previous_usernames?.some((name) => name.toLowerCase() === query.toLowerCase())) reasons.push(
    `Former username of active player ${user.username}. Renamed date is unverified; may be subject to manual restrictions.`,
  );
  const former = reasons.length > 0;
  if (profiles.some((profile) => profile.rank_highest?.rank > 0 && profile.rank_highest.rank <= 100)) reasons.push("Historical top-100 rank protection.");
  if ((user.ranked_beatmapset_count ?? user.ranked_and_approved_beatmapset_count ?? 0) > 0 ||
      (user.loved_beatmapset_count ?? 0) > 0 || (user.guest_beatmapset_count ?? 0) > 0) reasons.push("Ranked, loved, or guest mapper protection.");
  if (user.badges?.length > 0) reasons.push("Profile badge protection.");
  if (reasons.length > (former ? 1 : 0)) return { query, status: "Protected indefinitely", reasons };
  if (former) return { query, status: "Former username", reasons };
  const playcount = profiles.reduce((sum, profile) => sum + (profile.statistics?.play_count || 0), 0);
  const thresholdDays = Math.floor(180 + 1580 * (1 - Math.exp(-playcount / 5900)) + playcount * 8 / 5900);
  const lastVisit = user.last_visit ? Date.parse(user.last_visit) : NaN;
  if (!Number.isFinite(lastVisit)) return { query, status: "Unknown / Private Activity", reasons: ["Last activity is private or unavailable."] };
  const releaseAt = new Date(lastVisit + thresholdDays * 86_400_000).toISOString();
  return {
    query, thresholdDays, releaseAt,
    status: now >= Date.parse(releaseAt) ? "Eligible for release due to inactivity" : "Occupied",
    reasons: [`Inactivity threshold: ${thresholdDays} days across ${playcount} plays.`, "Release eligibility is an estimate; manual restrictions may apply."],
  };
}

module.exports = { validateUsername, calculateNameAvailability };
