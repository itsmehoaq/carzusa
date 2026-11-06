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

module.exports = { profileEmbed, scoreEmbed, beatmapEmbed, bwsEmbed, whatIfEmbed, matchCostEmbed };
