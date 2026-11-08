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
function profileBase(user, mode) {
  const embed = base().setTitle(`${safe(user.username)} • ${mode}`)
    .setURL(`https://osu.ppy.sh/users/${user.id}/${mode}`);
  if (user.avatar_url) embed.setThumbnail(new URL(user.avatar_url, "https://osu.ppy.sh").href);
  return embed;
}

function profileEmbed(user, mode = "osu") {
  const stats = user.statistics || {};
  return profileBase(user, mode).addFields(
    field("Global rank", `#${number(stats.global_rank)}`),
    field(`${user.country_code || "Country"} rank`, `#${number(stats.country_rank)}`),
    field("Performance", pp(stats.pp)),
    field("Accuracy", `${number(stats.hit_accuracy, 2)}%`),
    field("Playcount", number(stats.play_count)),
    field("Level", `${number(stats.level?.current)} (${number(stats.level?.progress)}%)`),
    field("Joined", date(user.join_date)),
  );
}

function scoreEmbed(score, user, { mode = "osu", kind = "Recent", index = 0, total = 1 } = {}) {
  const map = score.beatmap || {};
  const set = score.beatmapset || map.beatmapset || {};
  const embed = base().setTitle(safe(`${set.artist || "Unknown artist"} - ${set.title || "Unknown map"} [${map.version || "?"}]`))
    .setDescription(`${safe(user.username)} • ${kind} #${index + 1} • ${mode}\nMapped by ${safe(set.creator || map.user?.username)}`)
    .addFields(
      field("Score", number(score.total_score)),
      field("Combo", `${number(score.max_combo)}x${map.max_combo ? ` / ${number(map.max_combo)}x` : ""}`),
      field("Accuracy", `${number(score.accuracy, 2)}%`),
      field("Mods", score.mods?.length ? `+${score.mods.join("")}` : "NM"),
      field("Grade", score.rank || "—"), field("Performance", pp(score.pp)),
      field("Hits", Object.entries(score.statistics || {}).map(([key, value]) => `${key.replace(/^count_/, "")}: ${number(value)}`).join(" • ") || "—", false),
      field("Played", date(score.ended_at || score.created_at), false),
    ).setFooter({ text: `Play ${index + 1} of ${total}` });
  if (score.id) embed.setURL(`https://osu.ppy.sh/scores/${score.id}`);
  else if (map.id) embed.setURL(`https://osu.ppy.sh/beatmaps/${map.id}`);
  if (score.failed) embed.addFields(field("Failed", `${number(score.completion, 2)}% completion`));
  if (set.covers?.cover) embed.setImage(set.covers.cover);
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

module.exports = { profileEmbed, scoreEmbed, beatmapEmbed, bwsEmbed, whatIfEmbed, matchCostEmbed,
  avatarEmbed, pinnedEmbed, mostPlayedEmbed, checkNameEmbed, badgeEmbed, reachEmbed, scorepostEmbed };
