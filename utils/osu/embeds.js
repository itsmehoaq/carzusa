const { EmbedBuilder, escapeMarkdown } = require("discord.js");

const MODE_NAMES = { osu: "osu!", taiko: "osu!taiko", fruits: "osu!catch", mania: "osu!mania" };
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

function unmappedScoreListEmbed(scores, user, { mode = "osu", kind = "Top", page = 0, color } = {}) {
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
  return unmappedScoreListEmbed(scores, user, { ...options, kind: "Pinned" });
}

function bwsEmbed(user, result, mode = "osu", custom = false, options = {}) {
  return profileBase(user, mode, "Badge-weighted seeding", options).setDescription([
    `Rank **#${number(result.rank)}** → BWS **#${number(result.bwsRank)}**`,
    `${custom ? "Badge override" : "Tournament badges"}: **${number(result.badgeCount)}** • Adjustment **${number(result.adjustment, 2)}%**`,
  ].join("\n")).setFooter({ text: custom ? "Using your badge override." : "Tournament badge detection may be inaccurate." });
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

// Literal presentation port; license in THIRD_PARTY_NOTICES.md.
const source = require('./sourceDataAdapter');
const fmt = require('./presentationHelpers');
const SERVER_ICON = 'https://i.imgur.com/Req9wGs.png';
const sourceAvatar = (id, options) => `http://s.ppy.sh/a/${fmt.pyStr(id)}?${options.randomInt ?? Math.floor(Math.random() * 1001)}`;
const sourceFlag = user => `https://osu.ppy.sh/images/flags/${user.country}.png`;
const sourceProfile = user => `https://osu.ppy.sh/users/${user.user_id}`;
const sourceMapURL = map => `https://osu.ppy.sh/b/${map.beatmap_id}`;
const sourceThumb = map => `https://b.ppy.sh/thumb/${map.beatmapset_id}l.jpg`;
const sourceBase = options => new EmbedBuilder({ type: 'rich' }).setColor(options.color ?? 0);
function profileEmbed(input, mode = 'osu', options = {}) {
  const user = source.userData(input);
  let rankText = '', allZero = true;
  for (const rank of ['SSH', 'SS', 'SH', 'S', 'A']) {
    const count = user[`count_rank_${rank.toLowerCase()}`];
    if (count == null || !Number.isFinite(Number(count)) || typeof count === 'string' && !/^[+-]?\d+$/.test(count.trim())) continue;
    if (Number(count) !== 0) allZero = false;
    // Zero-only breakdowns are omitted by the source. Nonzero breakdowns need real assets.
  }
  if (!allZero) for (const rank of ['SSH', 'SS', 'SH', 'S', 'A']) {
    const count = user[`count_rank_${rank.toLowerCase()}`];
    if (count == null || !Number.isFinite(Number(count)) || typeof count === 'string' && !/^[+-]?\d+$/.test(count.trim())) continue;
    rankText += `${source.asset(options.rankEmotes, rank, 'rank')}\`${fmt.integer(count)}\``;
  }
  const countryRank = user.pp_country_rank != null ? ` (${user.country.toUpperCase()}#${fmt.integer(user.pp_country_rank)})` : ` (${user.country})`;
  const hours = user.total_seconds_played ? ` (${fmt.integer(fmt.round(Number(user.total_seconds_played) / 3600))} hrs)` : '';
  const ppText = 'pp_raw' in user ? `**PP:** ${fmt.fixed(fmt.round(user.pp_raw, 3), 2, true)}` : '';
  const acc = 'accuracy' in user ? `**Acc:** ${fmt.floatStr(fmt.round(user.accuracy, 2))}%` : '';
  let info = `▸ **Bancho Rank:** ${user.pp_rank != null ? '#' + fmt.integer(user.pp_rank) : '-'} ${countryRank}\n`;
  if ('level' in user) {
    const level = Math.trunc(Number(user.level));
    info += `▸ **Level:** ${level} + ${fmt.fixed(fmt.round((Number(user.level) - level) * 100, 4))}%\n`;
  }
  if (ppText || acc) info += `▸ ${ppText} ${acc}\n`;
  info += `▸ **Playcount:** ${fmt.integer(user.playcount)}${hours}\n`;
  if (rankText) info += `▸ **Ranks:** ${rankText}`;
  const icon = 'is_online' in user ? user.is_online ? 'https://i.imgur.com/DKLGecZ.png' : 'https://i.imgur.com/sOtDO3u.png' : SERVER_ICON;
  const verified = user.discord === `${options.discordName}#${options.discordDiscriminator ?? '0'}` ? ' | Verified' : '';
  return sourceBase(options).setDescription(info)
    .setAuthor({ name: `${source.modeText(mode)} Profile for ${user.username}`, iconURL: sourceFlag(user), url: sourceProfile(user) })
    .setThumbnail(sourceAvatar(user.user_id, options))
    .setFooter({ text: `On osu! Bancho Server${verified}`, iconURL: icon });
}
function recentHeader(user, mode = 'osu') {
  return `**Recent ${source.modeText(mode)} Play for ${user.username}:**`;
}
function attemptNumber(scores, beatmapId = null) {
  const first = source.scoreData(scores[0]);
  const checkId = beatmapId || first.beatmap_id;
  let found = false, count = 0;
  for (const input of scores) {
    const score = source.scoreData(input);
    if (score.beatmap_id === checkId) { found = true; count++; }
    else if (found) break;
  }
  return count;
}
function scoreEmbed(input, inputUser, options = {}) {
  const mode = source.modeNumber(options.mode ?? 'osu');
  const user = source.userData(inputUser);
  const score = source.scoreData(input, 1, mode);
  const map = source.mapData({ ...input.beatmap, beatmapset: input.beatmapset || input.beatmap?.beatmapset });
  const calc = source.calculationFor(input, input.beatmap, options);
  const extra = calc.extra_info;
  const playPP = score.pp && Number(score.pp) !== 0 ? Number(score.pp) : extra ? Number(extra.play_pp) : 0;
  let potential = '';
  if (calc != null) {
    if (extra && mode === 0 && calc.max_combo != null && (Number(score.count_miss) >= 1 || Number(score.max_combo) <= .96 * Number(calc.max_combo) && score.rank.includes('S')) && Math.abs(playPP - Number(extra.fc_pp)) > 3) {
      potential = `**${fmt.fixed(playPP)}PP** (${fmt.fixed(extra.fc_pp)}PP for ${fmt.fixed(extra.fc_acc)}% FC)`;
    } else if (score.rank.includes('S') || score.rank.includes('X')) potential = `**${fmt.fixed(playPP)}PP**`;
    else if (extra?.fc_pp != null && extra?.fc_acc != null) potential = `**${fmt.fixed(playPP)}PP** (${fmt.fixed(extra.fc_pp)}PP for ${fmt.fixed(extra.fc_acc)}% FC)`;
    else potential = `**${fmt.fixed(playPP)}PP** (_Unofficial_)`;
  }
  let info = `▸ **${source.asset(options.rankEmotes, score.rank, 'rank')}** ▸ ${potential} ▸ ${fmt.accText(score, mode, fmt.accuracy(score, mode))}\n`;
  const denominator = String(map.max_combo).toLowerCase().includes('none') || map.max_combo == null || String(map.max_combo) === '0' ? '' : `/${map.max_combo}`;
  info += `▸ ${fmt.integer(score.score)} ▸ x${score.max_combo}${denominator} ▸ ${fmt.breakdown(score, mode)}\n`;
  if (extra && 'map_completion' in extra && extra.map_completion !== 100) info += `▸ **Map Completion:** ${fmt.fixed(extra.map_completion)}%`;
  const mods = source.modList(score.enabled_mods);
  if (!mods.length) mods.push('No Mod');
  const star = fmt.starArrow(`${mode === 0 ? fmt.compare(calc, 'difficulty_rating', 'stars_mod', 2, true)[0] : fmt.adjusted(calc, 'difficulty_rating', score.enabled_mods, mode)}★`);
  const attempt = options.attemptNum ? `Try #${options.attemptNum} | ` : '';
  return sourceBase(options).setDescription(info)
    .setAuthor({ name: `${map.title} [${map.version}]${fmt.keys(map, mode)} +${source.fixMods(mods.join(''))} [${star}]`, url: sourceMapURL(map), iconURL: sourceAvatar(user.user_id, options) })
    .setThumbnail(sourceThumb(map))
    .setFooter({ text: `${attempt}${fmt.timeAgo(score.date, options.now)}Ago On osu! Bancho Server`, iconURL: SERVER_ICON });
}
function scoreListEmbed(inputs, inputUser, options = {}) {
  const user = source.userData(inputUser);
  const mode = source.modeNumber(options.mode ?? 'osu');
  const page = options.page ?? 0;
  const selected = inputs.slice(page * 5, (page + 1) * 5);
  const header = options.header ?? `Top ${selected.length} ${source.modeText(mode)} Play${selected.length === 1 ? '' : 's'} for ${user.username}`;
  let description = '';
  selected.forEach((input, offset) => {
    const play = source.scoreData(input, page * 5 + offset + 1, mode);
    const map = source.mapData({ ...input.beatmap, beatmapset: input.beatmapset || input.beatmap?.beatmapset });
    const calc = source.calculationFor(input, input.beatmap, options);
    const extra = calc.extra_info;
    const list = source.modList(play.enabled_mods);
    if (!list.length) list.push('No Mod');
    const numberText = !header.includes('Number') || selected.length !== 1 ? `${play.play_idx}. ` : '';
    const stars = mode === 0 ? fmt.fixed('stars_mod' in calc ? calc.stars_mod : calc.difficulty_rating) : fmt.adjusted(calc, 'difficulty_rating', play.enabled_mods, mode);
    const star = fmt.starArrow(`${stars}★`);
    let info = `**${numberText}[${map.title.replaceAll('*', '\\*')} [${map.version.replaceAll('*', '\\*')}]${fmt.keys(map, mode)}](${sourceMapURL(map)}) +${source.fixMods(list.join(''))}** [${star}]\n`;
    let choke = '';
    if (calc.max_combo != null && extra && 'fc_pp' in extra && mode === 0 && (Number(play.count_miss) >= 1 || Number(play.max_combo) <= .95 * Number(calc.max_combo) && play.rank.includes('S'))) choke = ` _(${fmt.fixed(extra.fc_pp)}pp for ${fmt.fixed(extra.fc_acc)}% FC)_`;
    const combo = calc.max_combo ? `x${fmt.integer(play.max_combo)}/${fmt.integer(calc.max_combo)}` : `x${fmt.integer(play.max_combo)}`;
    let ppText;
    if (play.pp != null && Number(play.pp) !== 0) ppText = `**${fmt.fixed(play.pp)}PP**${choke}`;
    else if (extra) {
      const playPP = Number(extra.play_pp);
      if (calc.max_combo != null && (Number(play.count_miss) >= 1 || Number(play.max_combo) <= .96 * Number(calc.max_combo) && play.rank.includes('S')) && Math.abs(playPP - Number(extra.fc_pp)) > 3) ppText = `**${fmt.fixed(playPP)}PP**${choke}`;
      else ppText = `**${fmt.fixed(playPP)}PP** (_Unofficial_)`;
    } else ppText = '**-PP** (_Unofficial_)';
    const acc = 'accuracy' in play ? play.accuracy : fmt.accuracy(play, mode);
    info += `▸ **${source.asset(options.rankEmotes, play.rank, 'rank')}** ▸ ${ppText} ▸ ${fmt.accText(play, mode, acc)}\n`;
    info += `▸ ${fmt.integer(play.score)} ▸ ${combo} ▸ ${fmt.breakdown(play, mode)}\n`;
    info += `▸ Score Set ${fmt.timeAgo(play.date, options.now)}Ago\n`;
    description += info;
  });
  const pageInfo = Object.hasOwn(options, 'pageInfo') ? options.pageInfo : [page + 1, Math.max(1, Math.ceil(inputs.length / 5))];
  const embed = sourceBase(options);
  embed.data.description = description;
  return embed
    .setAuthor({ name: header, url: sourceProfile(user), iconURL: sourceFlag(user) })
    .setFooter({ text: `On osu! Bancho Server${pageInfo ? ` | Page ${pageInfo[0]} of ${pageInfo[1]}` : ''}`, iconURL: SERVER_ICON })
    .setThumbnail(sourceAvatar(user.user_id, options));
}
function whatIfMessage(user, scores, newPP) {
  const old = scores.map(s => Number(s.pp));
  const next = [...old, newPP].sort((a, b) => b - a).slice(0, 100);
  let oldWeighted = 0, newWeighted = 0, index = -1;
  old.forEach((pp, i) => {
    oldWeighted += pp * .95 ** i;
    newWeighted += next[i] * .95 ** i;
    if (pp <= newPP && index === -1) index = i;
  });
  if (index === -1) return `**This would not be a top play for \`${user.username}\` and their total pp would not change.**`;
  const diff = newWeighted - oldWeighted;
  const total = Number(user.pp_raw ?? user.statistics?.pp);
  return `**A score of \`${fmt.fixed(fmt.round(newPP, 2), 2, true)}pp\` (\`${fmt.fixed(newPP * .95 ** index, 2, true)}pp\` weighted) for \`${user.username}\` would be their \`#${index + 1}\` top play and increase their total to \`${fmt.fixed(total + diff, 2, true)}pp\` (\`+${fmt.fixed(diff, 2, true)}\`).**`;
}
function linkMessage(discordName, username, exists = false) {
  return exists ? `:white_check_mark: **${discordName}, your \`Bancho\` username has been edited to \`${username}\`**` : `:white_check_mark: **${discordName}, your account has been linked to \`${username}\` on the \`Bancho\` server.**`;
}
const unlinkMessage = discordName => `:white_check_mark: **${discordName}, your \`Bancho\` username has been removed.**`;
const missingLinkUserMessage = username => `**\`${username}\` doesn't exist in the \`Bancho\` database.**`;
function sourceErrorMessage(command, username, mode, userExists = false) {
  if (command === 'profile') return `:red_circle: **\`${username}\` not found.**`;
  if (command === 'recent') return userExists
    ? `**\`${username}\` has no recent plays in \`Bancho\` for \`${source.modeText(mode)}\`**`
    : `**\`${username}\` was not found or no recent plays in \`Bancho\` for \`${source.modeText(mode)}\`.**`;
  return userExists ? `**\`${username}\` was not found or not enough plays in \`Bancho\`.**`
    : `**\`${username}\` not found in \`Bancho\`.**`;
}
function sourceStatus(status) {
  if (status == null) throw new TypeError('Missing source map status.');
  const values = [[-2, 'graveyard', 0xc10d0d, 'Graveyard'], [-1, 'wip', 0x713c93, 'Work in Progress'], [0, 'pending', 0x1466cc, 'Pending'], [1, 'ranked', 0x02cc37, 'Ranked'], [2, 'approved', 0x0f8c4a, 'Approved'], [3, 'qualified', 0x00cebd, 'Qualified'], [4, 'loved', 0xea04e6, 'Loved']];
  const found = values.find(([id, text, , label]) => String(status) === String(id) || String(status).toLowerCase() === text || String(status).toLowerCase() === label.toLowerCase());
  return found ? found.slice(2) : [0xffffff, 'Unknown'];
}
function beatmapEmbed(input, options = {}) {
  const inputs = Array.isArray(input) ? input : [input];
  const maps = inputs.map(source.mapData);
  const calculations = inputs.map(m => source.calculationFor(null, m, options));
  const first = calculations[0];
  const [color, status] = sourceStatus(maps[0].status);
  const mods = source.modNumber(options.mods || '');
  const modsText = source.fixMods(source.modList(mods).join(''));
  const changed = fmt.compare(first, 'total_length', 'total_length_mod')[1];
  const duration = length => `${Math.floor(Number(length) / 60)}:${String(Math.trunc(Number(length)) % 60).padStart(2, '0')}`;
  let desc = changed ? `**Length:** ${duration(first.total_length)}(${duration(first.total_length_mod)})  **BPM:** ${fmt.fixed(first.bpm, 1)}(${fmt.fixed(first.bpm_mod, 1)}) ` : `**Length:** ${duration(first.total_length)}  **BPM:** ${fmt.fixed(first.bpm, 1)} `;
  desc += `**Mods:** ${modsText || '-'}\n`;
  const accs = [95, 99, 100];
  const extra = options.extraInfo || {};
  if ('extra_acc' in extra) {
    if (extra.extra_acc <= accs[0]) accs[0] = extra.extra_acc;
    else if (extra.extra_acc <= accs[1]) accs[1] = extra.extra_acc;
    else if (extra.extra_acc <= accs[2]) accs[1] = extra.extra_acc;
  }
  const order = maps.map((map, i) => i).sort((a, b) => Number(maps[b].difficulty_rating) - Number(maps[a].difficulty_rating)).slice(0, 3);
  const embed = new EmbedBuilder({ type: 'rich', color });
  let last, calc;
  const times = [];
  for (const index of order) {
    last = maps[index]; calc = calculations[index];
    times.push(last.last_update);
    if ([1, 2].includes(maps[0].status) && last.last_updated) times.push(last.last_updated);
    const mode = Number(last.mode);
    const star = fmt.starArrow(`${mode === 0 ? fmt.compare(calc, 'difficulty_rating', 'stars_mod')[0] : fmt.adjusted(calc, 'difficulty_rating', mods, mode)}★`);
    const attrs = Object.fromEntries(['ar', 'od', 'hp', 'cs'].map(key => [key, mode === 0 ? fmt.compare(calc, key, `${key}_mod`, 1)[0] : fmt.adjusted(calc, key, mods, mode)]));
    let info = `**▸Difficulty:** ${star} **▸Max Combo:** ${calc.max_combo != null ? `x${calc.max_combo}` : '-'}\n`;
    info += [1, 3].includes(mode) ? `**▸OD:** ${attrs.od} **▸HP:** ${attrs.hp} **▸CS:** ${attrs.cs}\n` : `**▸AR:** ${attrs.ar} **▸OD:** ${attrs.od} **▸HP:** ${attrs.hp} **▸CS:** ${attrs.cs}\n`;
    info += '**▸PP:** ';
    accs.forEach((acc, i) => { info += `○ **${acc}%**–${fmt.fixed(calc.pp_mod[i])} `; });
    const diff = Number(last.difficulty_rating);
    const diffName = diff <= 1.99 ? 'easy' : diff <= 2.69 ? 'normal' : diff <= 3.99 ? 'hard' : diff <= 5.29 ? 'insane' : diff <= 6.49 ? 'expert' : 'expertplus';
    const emote = source.asset(options.diffEmotes?.[String(mode)], diffName, 'difficulty');
    embed.addFields({ name: `${emote} __${calc.version}__${last.convert ? ' [convert]' : ''}\n`, value: info, inline: false });
  }
  const set = last.beatmapset_id;
  const links = [['map', `https://osu.ppy.sh/d/${set}`]];
  if (Number(last.video)) links.push(['no vid', `https://osu.ppy.sh/d/${set}n`]);
  links.push(['nerina', `https://nerina.pw/d/${set}`], ['beatconnect', `https://beatconnect.io/b/${set}/`], ['sayobot', `https://osu.sayobot.cn/osu.php?s=${set}`]);
  desc += `**Download:** ${links.map(([name, url]) => `[${name}](${url})`).join(' | ')}\n`;
  const date = new Date((String(calc.status) === '1' ? calc.ranked_date : times.sort().reverse()[0]).replace(' ', 'T') + 'Z');
  const dateLabel = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }) + ` ${String(date.getUTCDate()).padStart(2, '0')} ${date.getUTCFullYear()}`;
  const request = 'username' in extra ? `Request for ${extra.username} | ` : '';
  return embed.setDescription(desc)
    .setAuthor({ name: `${calc.artist} – ${calc.title} by ${calc.creator}`, url: sourceMapURL(calc), iconURL: 'user_id' in maps[0] ? sourceAvatar(maps[0].user_id, options) : 'https://i.imgur.com/LrnCwlp.png' })
    .setFooter({ text: `${status} | ${calc.favourite_count} ❤︎ | ${request}${String(calc.status) === '1' ? 'Approved' : 'Last Updated'} ${dateLabel}` })
    .setThumbnail(sourceThumb(maps[0]));
}
function beatmapMessage(input, options = {}) {
  const count = Array.isArray(input) ? input.length : 1;
  return {
    ...(count > 3 ? { content: `Found ${count} maps, but only displaying 3.\n` } : {}),
    embeds: [beatmapEmbed(input, options)],
  };
}
module.exports = { profileEmbed, recentHeader, scoreEmbed, scoreListEmbed, beatmapEmbed, beatmapMessage, bwsEmbed, whatIfMessage, matchCostEmbed,
  avatarEmbed, pinnedEmbed, mostPlayedEmbed, checkNameEmbed, badgeEmbed, reachEmbed, scorepostEmbed,
  attemptNumber, linkMessage, unlinkMessage, missingLinkUserMessage, sourceErrorMessage };
