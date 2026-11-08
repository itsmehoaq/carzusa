const { EmbedBuilder, escapeMarkdown } = require("discord.js");

const MODE_NAMES = { osu: "osu!", taiko: "osu!taiko", fruits: "osu!catch", mania: "osu!mania" };
const STATUS_COLORS = { ranked: 0x66bb6a, approved: 0x66bb6a, qualified: 0x42a5f5, loved: 0xec6f9e, pending: 0xffb74d, wip: 0xffb74d, graveyard: 0x78909c };
const number = (value, digits = 0) => {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
  const formatted = Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return formatted.length > 24 ? Number(value).toExponential(digits) : formatted;
};
const pp = (value) => `${number(value, 2)} pp`;
const text = (value, limit = 200) => String(value ?? "Unknown").replace(/[\r\n\t]+/g, " ").slice(0, limit);
// Escape link delimiters too: map names can contain brackets and mention syntax.
const safe = (value, limit = 200) => {
  const escaped = escapeMarkdown(text(value, limit)).replace(/([\[\]<>])/g, "\\$1");
  return escaped.length > limit ? `${escaped.slice(0, limit - 1).replace(/\\+$/, "")}…` : escaped;
};
const base = ({ color } = {}) => new EmbedBuilder().setColor(color || 0x547b9b);
const modeName = (mode) => MODE_NAMES[mode] || "osu!";
const profileURL = (user, mode) => user.id ? `https://osu.ppy.sh/users/${user.id}/${mode}` : undefined;
const mapURL = (map) => map.id ? `https://osu.ppy.sh/beatmaps/${map.id}` : undefined;
const scoreURL = (score) => score.id ? `https://osu.ppy.sh/scores/${score.id}` : mapURL(score.beatmap || {});
const link = (label, url) => url ? `[${label}](${url})` : label;
function imageURL(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value, "https://osu.ppy.sh");
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}
function date(value, style = "f") {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? `<t:${Math.floor(timestamp / 1000)}:${style}>` : "—";
}
function elapsed(value) {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return "Date unavailable";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
function thumbnail(embed, value) {
  const url = imageURL(value);
  if (url) embed.setThumbnail(url);
  return embed;
}
function profileBase(user, mode, label = "", options = {}) {
  const embed = base(options).setAuthor({
    name: text(`${user.username || "Unknown player"} • ${label ? `${label} • ` : ""}${modeName(mode)}`, 256),
    url: profileURL(user, mode), iconURL: imageURL(user.avatar_url),
  });
  return embed;
}
function mapParts(score) {
  const map = score.beatmap || {};
  return { map, set: score.beatmapset || map.beatmapset || {} };
}
const mapTitle = (map, set) => `${text(set.artist || "Unknown artist", 70)} - ${text(set.title || "Unknown map", 85)} [${text(map.version || "?", 55)}]`;
function modsLabel(mods) {
  const acronyms = (Array.isArray(mods) ? mods : []).map((mod) => typeof mod === "string" ? mod : mod?.acronym).filter(Boolean);
  return acronyms.length ? `+${safe(acronyms.join(""), 32)}` : "NM";
}
const stars = (map) => `${number(map.difficulty_rating, 2)}★ base`;
function judgments(score, mode) {
  const stats = score.statistics || {};
  if (!Object.keys(stats).length) return "Judgments unavailable";
  const hit = (key, legacy) => stats[key] ?? stats[legacy] ?? 0;
  const pairs = mode === "mania"
    ? [["MAX", hit("perfect", "count_geki")], ["300", hit("great", "count_300")], ["200", hit("good", "count_katu")], ["100", hit("ok", "count_100")], ["50", hit("meh", "count_50")], ["Miss", hit("miss", "count_miss")]]
    : mode === "fruits"
      ? [["Fruit", hit("great", "count_300")], ["Drop", hit("large_tick_hit", "count_100")], ["Tiny", hit("small_tick_hit", "count_50")], ["Miss", hit("miss", "count_miss")], ["Drop miss", stats.large_tick_miss ?? ("count_300" in stats ? null : 0)], ["Tiny miss", hit("small_tick_miss", "count_katu")]]
      : mode === "taiko"
        ? [["300", hit("great", "count_300")], ["150", hit("ok", "count_100")], ["Miss", hit("miss", "count_miss")]]
        : [["300", hit("great", "count_300")], ["100", hit("ok", "count_100")], ["50", hit("meh", "count_50")], ["Miss", hit("miss", "count_miss")]];
  let result = pairs.map(([label, value]) => `${label}: ${number(value)}`).join(" / ");
  if (mode === "mania") {
    const perfect = Number(hit("perfect", "count_geki"));
    const great = Number(hit("great", "count_300"));
    result += ` • MAX/300: ${great > 0 ? number(perfect / great, 2) : perfect > 0 ? "∞" : "—"}`;
  }
  return result;
}
function scoreLines(score, mode) {
  const { map } = mapParts(score);
  // Scores arrive with percentage accuracy. Do not normalize a low percentage a second time.
  return [
    `**${safe(score.rank || "—", 4)}** • **${pp(score.pp)}** • **${number(score.accuracy, 2)}%**${score.id ? ` • ${link("Score", scoreURL(score))}` : ""}`,
    `${number(score.total_score)} score • ${number(score.max_combo)}x${map.max_combo ? ` / ${number(map.max_combo)}x` : ""}`,
    judgments(score, mode),
    ...(score.failed ? [`Failed • ${number(score.completion, 2)}% completion`] : []),
  ];
}
function downloadLinks(map, set) {
  return [mapURL(map) ? link("Beatmap", mapURL(map)) : null, set.id ? `[Download](https://osu.ppy.sh/beatmapsets/${set.id}/download) • [No video](https://osu.ppy.sh/beatmapsets/${set.id}/download?noVideo=1)` : null].filter(Boolean).join(" • ");
}

function profileEmbed(user, mode = "osu", options = {}) {
  const stats = user.statistics || {};
  const embed = profileBase(user, mode, "", options);
  if (/^[A-Z]{2}$/i.test(user.country_code || "")) embed.setAuthor({
    ...embed.data.author, iconURL: `https://osu.ppy.sh/images/flags/${user.country_code.toUpperCase()}.png`,
  });
  thumbnail(embed, user.avatar_url);
  const lines = [
    `**${pp(stats.pp)}** • Global **#${number(stats.global_rank)}** • ${safe(user.country_code || "Country", 12)} **#${number(stats.country_rank)}**`,
    `Accuracy **${number(stats.hit_accuracy, 2)}%** • Plays **${number(stats.play_count)}**`,
    `Level **${number(stats.level?.current)}** (${number(stats.level?.progress)}%)${stats.play_time != null ? ` • Play time **${number(stats.play_time / 3600, 1)}h**` : ""}`,
  ];
  if (stats.ranked_score != null || stats.total_score != null) lines.push(`Ranked score **${number(stats.ranked_score)}** • Total score **${number(stats.total_score)}**`);
  lines.push(`Joined ${date(user.join_date)}`);
  return embed.setDescription(lines.join("\n")).setFooter({ text: `osu!${typeof user.is_online === "boolean" ? ` • ${user.is_online ? "Online" : "Offline"}` : ""}` });
}

function recentHeader(user, mode = "osu") {
  return `Recent play for **${safe(user.username || "Unknown player", 60)}** • ${modeName(mode)}`;
}
function scoreEmbed(score, user, { mode = "osu", index = 0, total = 1, color } = {}) {
  const { map, set } = mapParts(score);
  const embed = base({ color }).setAuthor({
    name: text(`${text(mapTitle(map, set), 180)} • ${modsLabel(score.mods).replace(/\\/g, "")} • ${stars(map)}`, 256),
    url: mapURL(map), iconURL: imageURL(user.avatar_url),
  }).setDescription(scoreLines(score, mode).join("\n"))
    .setFooter({ text: `Play ${index + 1} of ${total} • ${elapsed(score.ended_at || score.created_at)}` });
  if (scoreURL(score)) embed.setURL(scoreURL(score));
  if (date(score.ended_at || score.created_at) !== "—") embed.setTimestamp(new Date(score.ended_at || score.created_at));
  return thumbnail(embed, set.covers?.cover || set.covers?.list);
}

function scoreListEmbed(scores, user, { mode = "osu", kind = "Top", page = 0, color } = {}) {
  const selected = scores.slice(page * 5, (page + 1) * 5);
  const embed = profileBase(user, mode, `${kind} plays`, { color });
  thumbnail(embed, user.avatar_url);
  const description = selected.map((score, offset) => {
    const { map, set } = mapParts(score);
    return [
      `**${page * 5 + offset + 1}.** ${link(safe(mapTitle(map, set), 125), mapURL(map))} • ${modsLabel(score.mods)} • ${stars(map)}`,
      ...scoreLines(score, mode),
      `Played ${date(score.ended_at || score.created_at, "R")}`,
    ].join("\n");
  }).join("\n\n");
  return embed.setDescription(description || `No ${kind.toLowerCase()} scores found.`)
    .setFooter({ text: `${kind} plays • Page ${page + 1}/${Math.max(1, Math.ceil(scores.length / 5))} • ${scores.length} scores` });
}
function pinnedEmbed(scores, user, options = {}) {
  return scoreListEmbed(scores, user, { ...options, kind: "Pinned" });
}

function beatmapEmbed(map, options = {}) {
  const set = map.beatmapset || {};
  const status = text(map.status || set.status || "Unknown status", 24);
  const embed = base({ color: STATUS_COLORS[status.toLowerCase()] || options.color }).setAuthor({
    name: text(`Mapped by ${set.creator || map.user?.username || "Unknown mapper"}`, 256),
    url: (set.user_id || map.user_id) ? `https://osu.ppy.sh/users/${set.user_id || map.user_id}` : undefined,
    iconURL: imageURL(map.user?.avatar_url),
  }).setTitle(text(mapTitle(map, set), 256));
  if (mapURL(map)) embed.setURL(mapURL(map));
  const length = Number.isFinite(Number(map.total_length)) && map.total_length != null ? Math.max(0, Math.floor(map.total_length)) : null;
  embed.setDescription(`Length **${length === null ? "—" : `${Math.floor(length / 60)}:${String(length % 60).padStart(2, "0")}`}** • BPM **${number(map.bpm, 1)}** • NM\n${downloadLinks(map, set) || "Download unavailable"}`);
  const mode = map.mode || ["osu", "taiko", "fruits", "mania"][map.mode_int ?? 0];
  const attributes = mode === "mania" ? `Keys **${number(map.cs)}** • OD **${number(map.accuracy, 1)}** • HP **${number(map.drain, 1)}**`
    : mode === "taiko" ? `OD **${number(map.accuracy, 1)}** • HP **${number(map.drain, 1)}**`
      : `CS **${number(map.cs, 1)}** • AR **${number(map.ar, 1)}**${mode === "fruits" ? "" : ` • OD **${number(map.accuracy, 1)}**`} • HP **${number(map.drain, 1)}**`;
  embed.addFields({ name: text(`${map.version || "Difficulty"} • ${number(map.difficulty_rating, 2)}★`, 256), value: attributes, inline: false });
  const updated = set.ranked_date || set.last_updated;
  const timestamp = updated ? Date.parse(updated) : NaN;
  embed.setFooter({ text: `${status} • ${number(set.favourite_count)} favorites • Raw map attributes${Number.isFinite(timestamp) ? ` • ${set.ranked_date ? "Ranked" : "Updated"} ${new Date(timestamp).toISOString().slice(0, 10)}` : ""}` });
  return thumbnail(embed, set.covers?.cover || set.covers?.list);
}

function bwsEmbed(user, result, mode = "osu", custom = false, options = {}) {
  return profileBase(user, mode, "Badge-weighted seeding", options).setDescription([
    `Rank **#${number(result.rank)}** → BWS **#${number(result.bwsRank)}**`,
    `${custom ? "Badge override" : "Tournament badges"}: **${number(result.badgeCount)}** • Adjustment **${number(result.adjustment, 2)}%**`,
  ].join("\n")).setFooter({ text: custom ? "Using your badge override." : "Tournament badge detection may be inaccurate." });
}

function whatIfMessage(user, result, newPP, mode = "osu") {
  return [
    `**${safe(user.username || "Unknown player", 60)}** • ${modeName(mode)} • What if`,
    `Hypothetical play: **${pp(newPP)}** • Placement: **${result.placement ? `#${result.placement}` : "Outside top 100"}**`,
    `Weighted contribution change: **${result.weightedDifference >= 0 ? "+" : ""}${pp(result.weightedDifference)}**`,
    `Projected weighted PP: **${pp(result.projectedWeightedPP)}** • Estimated total PP: **${pp(result.estimatedTotalPP)}**`,
    "Estimate from the top 100; bonus PP and plays outside this list are not recalculated.",
  ].join("\n");
}

function matchCostEmbed(result, page = 0, pageSize = 15, options = {}) {
  const players = result.players.slice(page * pageSize, (page + 1) * pageSize);
  const embed = base(options).setAuthor({ name: text(result.name || "osu! match", 256), url: `https://osu.ppy.sh/community/matches/${result.id}` });
  const lines = players.map((player, index) =>
    `**${page * pageSize + index + 1}. ${safe(player.username, 45)}**${page === 0 && index === 0 ? " • MVP" : ""}${player.team ? ` (${safe(player.team, 12)})` : ""} — **${number(player.matchCost, 2)}** • ${player.gamesPlayed}/${result.gamesPlayed} maps`);
  if (!lines.length) lines.push("No eligible games to evaluate.");
  if (result.teamVs && result.teamScore) lines.push(`\nTeam score: Red **${result.teamScore.red}** — **${result.teamScore.blue}** Blue`);
  if (result.truncated) lines.push("\nIncomplete history: This match exceeds the 500-event history limit. Costs cover only the retrieved events.");
  return embed.setDescription(lines.join("\n"))
    .setFooter({ text: `${result.gamesPlayed} evaluated maps • Match cost • Page ${page + 1}/${Math.max(1, Math.ceil(result.players.length / pageSize))}` });
}

function avatarEmbed(user, mode = "osu", options = {}) {
  const embed = profileBase(user, mode, "Avatar", options);
  const avatar = imageURL(user.avatar_url);
  return avatar ? embed.setImage(avatar) : embed.setDescription("Avatar unavailable.");
}

function mostPlayedEmbed(user, entries, page = 0, totalPages = Math.max(1, Math.ceil(entries.length / 10)), options = {}) {
  const embed = profileBase(user, options.mode || "osu", "Most played", options);
  thumbnail(embed, user.avatar_url);
  return embed.setDescription(entries.slice(page * 10, (page + 1) * 10).map((entry, index) => {
    const { map, set } = mapParts(entry);
    const download = set.id ? ` • [Download](https://osu.ppy.sh/beatmapsets/${set.id}/download)` : "";
    return `**${page * 10 + index + 1}.** ${link(safe(mapTitle(map, set), 90), mapURL(map))}\n${number(entry.count)} plays • ${number(map.difficulty_rating, 2)}★${download}`;
  }).join("\n\n") || "No most-played maps found.")
    .setFooter({ text: `Most played • Page ${page + 1}/${totalPages}` });
}

function checkNameEmbed(result, user = null, options = {}) {
  const embed = profileBase({ ...user, username: result.query }, "osu", "Username availability", options);
  const lines = [`**${safe(result.status, 100)}**`, ...(result.reasons || []).slice(0, 6).map((reason) => safe(reason, 550))];
  if (result.releaseAt) lines.push(`Eligible for release at ${date(result.releaseAt)}${date(result.releaseAt) === "—" ? "" : ` (${date(result.releaseAt, "R")})`}`);
  return embed.setDescription(lines.join("\n"));
}

function badgeEmbed(user, badges, page = 0, totalPages = Math.max(1, Math.ceil(badges.length / 5)), options = {}) {
  const selected = badges.slice(page * 5, (page + 1) * 5);
  if (!selected.length) return [profileBase(user, options.mode || "osu", "Profile badges", options).setDescription("No profile badges found.")
    .setFooter({ text: `Profile badges • Page ${page + 1}/${totalPages}` })];
  return selected.map((badge) => {
    const embed = profileBase(user, options.mode || "osu", "Profile badges", options).setDescription(`**${link(safe(badge.description, 200), imageURL(badge.url))}**\nAwarded ${date(badge.awarded_at)}`)
      .setFooter({ text: `Profile badges • Page ${page + 1}/${totalPages}` });
    const image = imageURL(badge.image_url || badge['image@2x_url']);
    if (image) embed.setImage(image);
    return embed;
  });
}

function reachEmbed(user, result, mode = "osu", targetPlayer = null, options = {}) {
  const embed = profileBase(user, mode, options.kind || "Reach", options);
  const lines = [];
  if (result.message) lines.push(safe(result.message, 400));
  if (targetPlayer) lines.push(`Target player: ${link(safe(targetPlayer.username, 60), profileURL(targetPlayer, mode))}`);
  if (options.targetRank) lines.push(`Target rank: **${safe(options.targetRank, 12)}**`);
  lines.push(`Target PP: **${pp(result.targetPP)}**`);
  if (result.numPlays !== undefined) lines.push(`Required plays: **${number(result.numPlays)}** • PP per play: **${pp(result.eachPP)}**`, `Projected total: **${pp(result.projectedTotal)}**`);
  return embed.setDescription(lines.join("\n")).setFooter({ text: "Estimate from the top 100; residual PP is preserved without recalculating bonus PP." });
}

function scorepostEmbed(score, user, title, options = {}) {
  const mode = options.mode || score.mode || ["osu", "taiko", "fruits", "mania"][score.ruleset_id ?? score.mode_int ?? 0];
  const embed = profileBase(user, mode, "Scorepost", options);
  const codeTitle = String(title).replace(/`/g, "ˋ").replace(/[\r\n]/g, " ").slice(0, 3500);
  const { set } = mapParts(score);
  const details = [
    `**${safe(score.rank || "—", 4)}** • ${number(score.total_score)} score • ${link("Score", scoreURL(score))}`,
    judgments(score, mode),
    `Played ${date(score.ended_at || score.created_at)}`,
    ...(score.failed ? [`Failed • ${number(score.completion, 2)}% completion`] : []),
  ];
  return thumbnail(embed.setDescription(`\`\`\`\n${codeTitle}\n\`\`\`\n${details.join("\n")}`), set.covers?.cover || set.covers?.list);
}

module.exports = { profileEmbed, recentHeader, scoreEmbed, scoreListEmbed, beatmapEmbed, bwsEmbed, whatIfMessage, matchCostEmbed,
  avatarEmbed, pinnedEmbed, mostPlayedEmbed, checkNameEmbed, badgeEmbed, reachEmbed, scorepostEmbed };
