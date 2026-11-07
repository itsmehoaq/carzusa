const { EmbedBuilder, escapeMarkdown } = require("discord.js");

const number = (value, digits = 0) => Number.isFinite(Number(value)) && value !== null && value !== undefined
  ? Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";
const pp = (value) => `${number(value, 2)} pp`;
const safe = (value, limit = 256) => escapeMarkdown(String(value ?? "Unknown")).slice(0, limit);
const base = () => new EmbedBuilder().setColor("#ed77a7");
const field = (name, value, inline = true) => ({ name, value: String(value).slice(0, 1024) || "—", inline });
function date(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? `<t:${Math.floor(timestamp / 1000)}:f>` : "—";
}
function timeAgo(dateInput) {
  if (!dateInput) return "";
  let timestamp;
  if (dateInput instanceof Date) {
    timestamp = dateInput.getTime();
  } else if (typeof dateInput === "number") {
    timestamp = dateInput;
  } else {
    timestamp = Date.parse(dateInput);
  }
  if (!Number.isFinite(timestamp)) return "";
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) {
    const months = Math.max(1, Math.floor(days / 30));
    return `${months}mo ago`;
  }
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

function normalizeRulesetId(mode) {
  if (typeof mode === "number" && Number.isInteger(mode) && mode >= 0 && mode <= 3) {
    return mode;
  }
  const str = String(mode ?? "").toLowerCase().trim();
  switch (str) {
    case "0":
    case "osu":
    case "standard":
      return 0;
    case "1":
    case "taiko":
      return 1;
    case "2":
    case "fruits":
    case "catch":
    case "ctb":
      return 2;
    case "3":
    case "mania":
      return 3;
    default:
      return 0;
  }
}

function getScoreBreakdown(score = {}, mode) {
  const stats = score?.statistics || {};
  const ruleset = normalizeRulesetId(mode ?? score?.ruleset_id ?? score?.mode_int ?? score?.mode);
  const c300 = Number(stats.count_300 ?? stats.great ?? 0) || 0;
  const c100 = Number(stats.count_100 ?? stats.ok ?? 0) || 0;
  const c50 = Number(stats.count_50 ?? stats.meh ?? 0) || 0;
  const cmiss = Number(stats.count_miss ?? stats.miss ?? 0) || 0;
  const cgeki = Number(stats.count_geki ?? stats.perfect ?? 0) || 0;
  const ckatu = Number(stats.count_katu ?? stats.good ?? 0) || 0;

  if (ruleset === 1) {
    return `[${c300}/${c100}/${cmiss}]`;
  }
  if (ruleset === 3) {
    return `[${cgeki}/${c300}/${ckatu}/${c100}/${c50}/${cmiss}]`;
  }
  return `[${c300}/${c100}/${c50}/${cmiss}]`;
}

function formatMods(mods) {
  if (!mods) return "";
  const arr = Array.isArray(mods)
    ? mods.map((m) => (typeof m === "string" ? m : m?.acronym)).filter(Boolean)
    : [];
  if (!arr.length) return "";
  const joined = arr.join("");
  if (!joined || joined.toUpperCase() === "NM") return "";
  return `+${joined}`;
}

function profileBase(user, mode) {
  const embed = base().setTitle(`${safe(user.username)} • ${mode}`)
    .setURL(`https://osu.ppy.sh/users/${user.id}/${mode}`);
  if (user.avatar_url) {
    try {
      embed.setThumbnail(new URL(user.avatar_url, "https://osu.ppy.sh").href);
    } catch {
      embed.setThumbnail(user.avatar_url);
    }
  }
  return embed;
}

function profileEmbed(user, mode = "osu") {
  const stats = user.statistics || {};
  const rulesetId = normalizeRulesetId(mode);
  const modeDisplay = { 0: "osu!standard", 1: "osu!taiko", 2: "osu!catch", 3: "osu!mania" }[rulesetId] || "osu!standard";
  const modeSlug = ["osu", "taiko", "fruits", "mania"][rulesetId] || "osu";
  const profileUrl = user.id ? `https://osu.ppy.sh/users/${user.id}/${modeSlug}` : undefined;

  const rawCountry = user.country_code || user.country?.code || (typeof user.country === "string" ? user.country : null);
  const countryCode = typeof rawCountry === "string" ? rawCountry.toUpperCase() : null;
  const flagIcon = countryCode && /^[A-Z]{2}$/.test(countryCode)
    ? `https://osu.ppy.sh/images/flags/${countryCode}.png`
    : undefined;

  const embed = base();
  const authorOpts = {
    name: `${modeDisplay} Profile for ${safe(user.username)}`,
  };
  if (profileUrl) authorOpts.url = profileUrl;
  if (flagIcon) authorOpts.iconURL = flagIcon;
  embed.setAuthor(authorOpts);

  if (profileUrl) embed.setURL(profileUrl);

  if (user.avatar_url) {
    try {
      embed.setThumbnail(new URL(user.avatar_url, "https://osu.ppy.sh").href);
    } catch {
      embed.setThumbnail(user.avatar_url);
    }
  }

  const hasCountryRank = Number.isFinite(Number(stats.country_rank)) && stats.country_rank !== null;
  const countryRankStr = countryCode
    ? (hasCountryRank ? ` (${countryCode}#${number(stats.country_rank)})` : ` (${countryCode})`)
    : "";

  const descLines = [];
  descLines.push(`▸ **osu! Rank:** #${number(stats.global_rank)}${countryRankStr}`);

  if (stats.level) {
    descLines.push(`▸ **Level:** ${number(stats.level.current)} + ${number(stats.level.progress)}%`);
  }

  descLines.push(`▸ **PP:** ${number(stats.pp, 2)} **Acc:** ${number(stats.hit_accuracy, 2)}%`);

  const secondsPlayed = Number(stats.play_time ?? stats.total_seconds_played ?? user.total_seconds_played);
  let hoursPlayedStr = "";
  if (Number.isFinite(secondsPlayed) && secondsPlayed > 0) {
    const hours = Math.round(secondsPlayed / 3600);
    hoursPlayedStr = ` (${number(hours)} hrs)`;
  }
  descLines.push(`▸ **Playcount:** ${number(stats.play_count)}${hoursPlayedStr}`);

  if (stats.grade_counts && typeof stats.grade_counts === "object") {
    const grades = [
      ["SSH", stats.grade_counts.ssh ?? stats.grade_counts.SSH ?? 0],
      ["SS", stats.grade_counts.ss ?? stats.grade_counts.SS ?? 0],
      ["SH", stats.grade_counts.sh ?? stats.grade_counts.SH ?? 0],
      ["S", stats.grade_counts.s ?? stats.grade_counts.S ?? 0],
      ["A", stats.grade_counts.a ?? stats.grade_counts.A ?? 0],
    ];
    const totalGrades = grades.reduce((acc, [, val]) => acc + (Number(val) || 0), 0);
    if (totalGrades > 0) {
      const gradeStr = grades.map(([name, val]) => `**${name}** \`${number(val)}\``).join(" ");
      descLines.push(`▸ **Ranks:** ${gradeStr}`);
    }
  }

  embed.setDescription(descLines.join("\n"));

  embed.addFields(
    field("Global rank", `#${number(stats.global_rank)}`),
    field(`${user.country_code || "Country"} rank`, `#${number(stats.country_rank)}`),
    field("Performance", pp(stats.pp)),
    field("Accuracy", `${number(stats.hit_accuracy, 2)}%`),
    field("Playcount", number(stats.play_count)),
    field("Level", `${number(stats.level?.current)} (${number(stats.level?.progress)}%)`),
    field("Joined", date(user.join_date)),
  );

  return embed;
}

function scoreEmbed(score, user, { mode = "osu", kind = "Recent", index = 0, total = 1 } = {}) {
  const map = score.beatmap || {};
  const set = score.beatmapset || map.beatmapset || {};
  const rulesetId = normalizeRulesetId(mode ?? score.ruleset_id ?? score.mode_int ?? score.mode);

  const titleText = `${set.artist || "Unknown artist"} - ${set.title || "Unknown map"} [${map.version || "?"}]`;
  const mapper = safe(set.creator || map.user?.username || "Unknown");

  const formattedMods = formatMods(score.mods);
  const modSegment = formattedMods ? ` ${formattedMods}` : "";
  const starStr = Number.isFinite(Number(map.difficulty_rating)) && map.difficulty_rating !== null
    ? ` [${number(map.difficulty_rating, 2)}★]`
    : "";

  const targetUrl = score.id
    ? `https://osu.ppy.sh/scores/${score.id}`
    : (map.id ? `https://osu.ppy.sh/beatmaps/${map.id}` : undefined);

  const embed = base().setTitle(safe(titleText));
  if (targetUrl) embed.setURL(targetUrl);

  const authorOpts = {
    name: `${safe(titleText)}${modSegment}${starStr}`,
  };
  if (targetUrl) authorOpts.url = targetUrl;
  if (user?.avatar_url) {
    try {
      authorOpts.iconURL = new URL(user.avatar_url, "https://osu.ppy.sh").href;
    } catch {
      authorOpts.iconURL = user.avatar_url;
    }
  }
  embed.setAuthor(authorOpts);

  const thumbnail = set.covers?.list || set.covers?.cover;
  if (thumbnail) {
    try {
      embed.setThumbnail(new URL(thumbnail, "https://osu.ppy.sh").href);
    } catch {
      embed.setThumbnail(thumbnail);
    }
  }

  const grade = score.rank || "—";
  const ppText = pp(score.pp);
  const breakdown = getScoreBreakdown(score, rulesetId);
  const maxComboStr = Number.isFinite(Number(map.max_combo)) && Number(map.max_combo) > 0
    ? `/${number(map.max_combo)}`
    : "";

  const descLines = [
    `▸ **${kind} #${index + 1}** • Mapped by ${mapper}`,
    `▸ **${grade}** ▸ ${ppText} ▸ ${number(score.accuracy, 2)}%`,
    `▸ ${number(score.total_score)} ▸ x${number(score.max_combo)}${maxComboStr} ▸ ${breakdown}`,
  ];

  if (score.failed && score.completion !== null && score.completion !== undefined) {
    descLines.push(`▸ **Map Completion:** ${number(score.completion, 2)}%`);
  }

  embed.setDescription(descLines.join("\n"));

  embed.addFields(
    field("Score", number(score.total_score)),
    field("Combo", `${number(score.max_combo)}x${map.max_combo ? ` / ${number(map.max_combo)}x` : ""}`),
    field("Accuracy", `${number(score.accuracy, 2)}%`),
    field("Mods", score.mods?.length ? `+${score.mods.join("")}` : "NM"),
    field("Grade", score.rank || "—"),
    field("Performance", pp(score.pp)),
    field("Hits", Object.entries(score.statistics || {}).map(([key, value]) => `${key.replace(/^count_/, "")}: ${number(value)}`).join(" • ") || "—", false),
    field("Played", date(score.ended_at || score.created_at), false),
  );

  if (score.failed) {
    embed.addFields(field("Failed", `${number(score.completion, 2)}% completion`));
  }

  const ago = timeAgo(score.ended_at || score.created_at);
  embed.setFooter({ text: `Play ${index + 1} of ${total}${ago ? ` • ${ago}` : ""}` });

  return embed;
}

function beatmapEmbed(map) {
  const set = map.beatmapset || {};
  const length = Number(map.total_length) || 0;
  const embed = base().setTitle(safe(`${set.artist || "Unknown artist"} - ${set.title || "Unknown map"} [${map.version || "?"}]`))
    .setURL(`https://osu.ppy.sh/beatmaps/${map.id}`)
    .setDescription(`Mapped by ${safe(set.creator || map.user?.username)} • Raw map attributes`)
    .addFields(
      field("CS / AR / OD / HP", `${number(map.cs, 1)} / ${number(map.ar, 1)} / ${number(map.accuracy, 1)} / ${number(map.drain, 1)}`, false),
      field("BPM", number(map.bpm, 1)), field("Length", `${Math.floor(length / 60)}:${String(length % 60).padStart(2, "0")}`),
      field("Stars", `${number(map.difficulty_rating, 2)}★`),
      field("Download", `[Beatmap](https://osu.ppy.sh/beatmaps/${map.id})${set.id ? ` • [With video](https://osu.ppy.sh/beatmapsets/${set.id}/download) • [Without video](https://osu.ppy.sh/beatmapsets/${set.id}/download?noVideo=1)` : ""}`, false),
    );
  if (set.covers?.cover) embed.setImage(set.covers.cover);
  return embed;
}

function bwsEmbed(user, result, mode = "osu", custom = false) {
  return profileBase(user, mode).setDescription("Badge-weighted seeding")
    .addFields(field("Rank", `#${number(result.rank)}`), field(custom ? "Badge override" : "Tournament badges", number(result.badgeCount)),
      field("BWS rank", `#${number(result.bwsRank)}`), field("Adjustment", `${number(result.adjustment, 2)}%`))
    .setFooter({ text: custom ? "Using your badge override." : "Tournament badge detection may be inaccurate." });
}

function whatIfEmbed(user, result, newPP, mode = "osu") {
  return profileBase(user, mode).setDescription(`What if ${safe(user.username)} earned ${pp(newPP)}?`)
    .addFields(field("Hypothetical play", pp(newPP)), field("Placement", result.placement ? `#${result.placement}` : "Outside top 100"),
      field("Weighted delta", `${result.weightedDifference >= 0 ? "+" : ""}${pp(result.weightedDifference)}`),
      field("Projected weighted PP", pp(result.projectedWeightedPP)), field("Estimated total PP", pp(result.estimatedTotalPP)))
    .setFooter({ text: "Estimate from the top 100; bonus PP and plays outside this list are not recalculated." });
}

function matchCostEmbed(result, page = 0, pageSize = 15) {
  const players = result.players.slice(page * pageSize, (page + 1) * pageSize);
  const embed = base().setTitle(safe(result.name || "osu! match"))
    .setURL(`https://osu.ppy.sh/community/matches/${result.id}`)
    .setDescription(players.map((player, index) =>
      `**#${page * pageSize + index + 1} ${safe(player.username, 64)}**${page === 0 && index === 0 ? " • MVP" : ""}${player.team ? ` (${player.team})` : ""} — **${number(player.matchCost, 2)}** • ${player.gamesPlayed}/${result.gamesPlayed} maps`).join("\n") || "No eligible games to evaluate.")
    .setFooter({ text: `${result.gamesPlayed} evaluated maps • Page ${page + 1}/${Math.max(1, Math.ceil(result.players.length / pageSize))}` });
  if (result.teamVs && result.teamScore) embed.addFields(field("Team score", `Red ${result.teamScore.red} — ${result.teamScore.blue} Blue`, false));
  if (result.truncated) embed.addFields(field("Incomplete history", "This match exceeds the 500-event history limit. Costs cover only the retrieved events.", false));
  return embed;
}

function avatarEmbed(user, mode = "osu") {
  const embed = profileBase(user, mode);
  if (user.avatar_url) embed.setImage(new URL(user.avatar_url, "https://osu.ppy.sh").href);
  return embed;
}

function pinnedEmbed(score, user, options = {}) {
  return scoreEmbed(score, user, { ...options, kind: "Pinned" });
}

function mostPlayedEmbed(user, entries, page = 0, totalPages = Math.max(1, Math.ceil(entries.length / 10))) {
  return profileBase(user, "osu").setDescription(entries.slice(page * 10, (page + 1) * 10).map((entry, index) => {
    const map = entry.beatmap || {};
    const set = entry.beatmapset || map.beatmapset || {};
    return `**${page * 10 + index + 1}.** [${safe(`${set.artist || "Unknown artist"} - ${set.title || "Unknown title"} [${map.version || "?"}]`, 220)}](https://osu.ppy.sh/beatmaps/${map.id}) • ${number(entry.count)} plays • ${number(map.difficulty_rating, 2)}★`;
  }).join("\n") || "No most-played maps found.")
    .setFooter({ text: `Most played • Page ${page + 1}/${totalPages}` });
}

function checkNameEmbed(result) {
  const embed = base().setTitle(`Username: ${safe(result.query)}`)
    .addFields(field("Status", result.status, false), field("Reasons", result.reasons.map((reason) => safe(reason, 700)).join("\n"), false));
  if (result.releaseAt) {
    const timestamp = Math.floor(Date.parse(result.releaseAt) / 1000);
    embed.addFields(field("Eligible for release at", `${date(result.releaseAt)} (<t:${timestamp}:R>)`, false));
  }
  return embed;
}

function badgeEmbed(user, badges, page = 0, totalPages = Math.max(1, Math.ceil(badges.length / 5))) {
  const selected = badges.slice(page * 5, (page + 1) * 5);
  if (!selected.length) return [profileBase(user, "osu").setDescription("No profile badges found.")
    .setFooter({ text: `Profile badges • Page ${page + 1}/${totalPages}` })];
  return selected.map((badge) => {
    const image = badge.image_url || badge['image@2x_url'];
    const embed = profileBase(user, "osu").setDescription(`**${safe(badge.description, 200)}**\nAwarded ${date(badge.awarded_at)}`)
      .setFooter({ text: `Profile badges • Page ${page + 1}/${totalPages}` });
    if (image) embed.setImage(new URL(image, "https://osu.ppy.sh").href);
    return embed;
  });
}

function reachEmbed(user, result, mode = "osu", targetPlayer = null) {
  const embed = profileBase(user, mode).setDescription(result.message || "Estimated plays needed to reach the target.")
    .addFields(field("Target PP", pp(result.targetPP)));
  if (targetPlayer) embed.addFields(field("Target player", `[${safe(targetPlayer.username)}](https://osu.ppy.sh/users/${targetPlayer.id}/${mode})`));
  if (result.numPlays !== undefined) embed.addFields(field("Required plays", number(result.numPlays)),
    field("PP per play", pp(result.eachPP)), field("Projected total", pp(result.projectedTotal)));
  return embed.setFooter({ text: "Estimate from the top 100; residual PP is preserved without recalculating bonus PP." });
}

function scorepostEmbed(score, user, title) {
  const embed = scoreEmbed(score, user, { kind: "Scorepost" });
  // Keep user-supplied names from closing the title's code fence.
  const codeTitle = title.replace(/`/g, "ˋ").replace(/[\r\n]/g, " ").slice(0, 3500);
  return embed.setDescription(`\`\`\`\n${codeTitle}\n\`\`\`\n[Score](https://osu.ppy.sh/scores/${score.id})`);
}

module.exports = {
  timeAgo,
  normalizeRulesetId,
  getScoreBreakdown,
  formatMods,
  profileEmbed,
  scoreEmbed,
  beatmapEmbed,
  bwsEmbed,
  whatIfEmbed,
  matchCostEmbed,
  avatarEmbed,
  pinnedEmbed,
  mostPlayedEmbed,
  checkNameEmbed,
  badgeEmbed,
  reachEmbed,
  scorepostEmbed,
};
