const api = require("./osuClient");
const db = require("./osuDb");
const { resolveTarget, MODES } = require("./osuTargetResolver");
const { calculateBws } = require("./calculations/bws");
const { evaluateMatchCost } = require("./calculations/matchCost");
const { calculateReach } = require("./calculations/reach");
const { validateUsername, calculateNameAvailability } = require("./calculations/nameAvailability");
const { createScorepostTitle } = require("./calculations/scorepost");
const embeds = require("./embeds");
const pagination = require("./paginationHelper");
const performance = require("./calculations/performance");
const { emptyAssets } = require("./sourceDataAdapter");

function parseResourceId(input, kind) {
  const value = String(input || "").trim();
  if (/^[1-9]\d*$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.hostname !== "osu.ppy.sh" || !["https:", "http:"].includes(url.protocol)) throw new Error();
    const match = kind === "beatmap"
      ? url.pathname.match(/^\/(?:beatmaps|b)\/([1-9]\d*)\/?$/) ||
        (/^\/beatmapsets\/\d+\/?$/.test(url.pathname) && url.hash.match(/^#(?:osu|taiko|fruits|mania)\/([1-9]\d*)$/))
      : url.pathname.match(/^\/(?:community\/matches|mp)\/([1-9]\d*)\/?$/);
    if (match) return match[1];
  } catch { /* Report the same validation error for all malformed links. */ }
  throw new Error(`Provide a valid ${kind} ID or osu.ppy.sh ${kind} URL${kind === "beatmap" ? " with a specific difficulty" : ""}.`);
}

function parseScoreResourceId(input) {
  const value = String(input || "").trim();
  if (/^[1-9]\d*$/.test(value)) return { id: value, mode: null };
  try {
    const url = new URL(value);
    if (url.origin !== "https://osu.ppy.sh") throw new Error();
    const match = url.pathname.match(/^\/scores\/(?:(osu|taiko|fruits|mania)\/)?([1-9]\d*)\/?$/);
    if (match) return { id: match[2], mode: match[1] || null };
  } catch { /* Use one error for malformed and foreign URLs. */ }
  throw new Error("Provide a valid score ID or osu.ppy.sh score URL.");
}

const COUNTRY_CODES = new Set(("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(" "));

function parseRankTarget(input) {
  const match = String(input || "").trim().toUpperCase().match(/^(?:([A-Z]{2}))?#?([1-9]\d*)$/);
  if (!match || match[1] && !COUNTRY_CODES.has(match[1])) throw new Error("Provide a global rank (#50) or ISO country rank (VN50 or VN#50).");
  const rank = Number(match[2]);
  if (rank > 10_000) throw new Error("Ranks beyond #10,000 are not supported by the official osu! rankings API.");
  return { rank, country: match[1] || null };
}

async function executeOsu(interaction, alias = null, presentation = {}) {
  if ((interaction.guildId ?? interaction.guild?.id) !== "723867861600174090") return;
  // This must precede option resolution, database lookups, and HTTP requests for every entry point.
  await interaction.deferReply();
  try {
    const command = alias || interaction.options.getSubcommand();
    const memberColor = interaction.member?.displayColor || interaction.member?.displayHexColor;
    const display = { color: memberColor === "#000000" ? undefined : memberColor };
    const sourceDisplay = { color: interaction.member?.displayColor ?? memberColor ?? 0,
      discordName: interaction.user.username, discordDiscriminator: interaction.user.discriminator ?? "0", ...emptyAssets(), ...presentation };
    const string = (name) => interaction.options.getString(name);
    const integer = (name) => interaction.options.getInteger(name);
    if (command === "unlink") {
      const removed = await db.unlinkUser(interaction.user.id);
      return interaction.editReply({ content: removed ? embeds.unlinkMessage(interaction.user.username) : "Could not remove your link. The database is unavailable." });
    }
    if (command === "link") {
      const mode = string("mode") || "osu";
      let user;
      try { user = await api.getUser(string("username"), mode); }
      catch (error) {
        if (error.response?.status !== 404) throw error;
        return interaction.editReply({ content: embeds.missingLinkUserMessage(string("username")), allowedMentions: { parse: [] } });
      }
      const existing = await db.getLinkedUser(interaction.user.id);
      const linked = await db.linkUser(interaction.user.id, user.id, user.username, mode);
      return interaction.editReply({
        content: linked ? embeds.linkMessage(interaction.user.username, user.username, Boolean(existing)) : "Could not save your link. The database is unavailable.",
        allowedMentions: { parse: [] },
      });
    }
    if (command === "map") {
      const map = await api.getBeatmap(parseResourceId(string("beatmap_id_or_url"), "beatmap"));
      map.sourceCalculation = await performance.calculate(map);
      return interaction.editReply(embeds.beatmapMessage(map, sourceDisplay));
    }
    if (command === "matchcost") {
      const match = await api.getMatch(parseResourceId(string("match_id_or_url"), "match"));
      const result = evaluateMatchCost(match, {
        warmups: integer("warmups") ?? 0, skip: integer("skip") ?? 0, ez: interaction.options.getNumber("ez") ?? 1.78,
      });
      const pages = Array.from({ length: Math.max(1, Math.ceil(result.players.length / 15)) }, (_, page) => embeds.matchCostEmbed(result, page, 15, display));
      return await pagination.paginate(interaction, pages);
    }
    if (command === "checkname") {
      const query = string("query");
      const validation = validateUsername(query);
      if (!validation.valid) throw new Error(validation.reason);
      let user;
      try {
        user = await api.getUserByUsername(query, "osu");
      } catch (error) {
        if (error.response?.status !== 404) throw error;
        return interaction.editReply({ embeds: [embeds.checkNameEmbed(calculateNameAvailability(query, null), null, display)] });
      }
      const fetched = await Promise.allSettled(MODES.map((mode) => api.getUser(user.id, mode)));
      const profiles = fetched.every((result) => result.status === "fulfilled") ? fetched.map((result) => result.value) : null;
      return interaction.editReply({ embeds: [embeds.checkNameEmbed(calculateNameAvailability(query, user, profiles), user, display)] });
    }
    if (command === "scorepost") {
      const resource = parseScoreResourceId(string("score_id_or_url"));
      let score = await api.getScore(resource.id, resource.mode);
      const mode = resource.mode || score.mode || MODES[score.ruleset_id ?? score.mode_int ?? 0];
      const user = score.user || await api.getUser(score.user_id, mode);
      if (score.beatmap?.id || score.beatmap_id) {
        // Score responses can omit calculation attributes even when combo/set exist.
        const map = await api.getBeatmap(score.beatmap?.id ?? score.beatmap_id);
        score.beatmap = { ...score.beatmap, ...map };
      }
      score = await performance.enrichScore(score, score.beatmap, mode, { effectivePP: true });
      return interaction.editReply({ embeds: [embeds.scorepostEmbed(score, user, createScorepostTitle(score, user), { ...display, mode })] });
    }

    const { target, mode } = await resolveTarget(interaction, string("username"), string("mode"));
    let user;
    try { user = await api.getUser(target, mode); }
    catch (error) {
      if (error.response?.status !== 404 || !["profile", "recent", "top", "whatif"].includes(command)) throw error;
      const content = embeds.sourceErrorMessage(command, target, mode);
      return interaction.editReply({ content, allowedMentions: { parse: [] } });
    }
    if (command === "profile") return interaction.editReply({ embeds: [embeds.profileEmbed(user, mode, sourceDisplay)] });
    if (command === "avatar") return interaction.editReply({ embeds: [embeds.avatarEmbed(user, mode, display)] });
    if (command === "mostplayed" || command === "badge") {
      const entries = command === "mostplayed" ? await api.getUserMostPlayed(user.id) : user.badges || [];
      const pageSize = command === "mostplayed" ? 10 : 5;
      const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
      const index = (integer("page") ?? 1) - 1;
      if (index < 0 || index >= totalPages) throw new Error(`Choose a page between 1 and ${totalPages}.`);
      const build = command === "mostplayed" ? embeds.mostPlayedEmbed : embeds.badgeEmbed;
      const pages = Array.from({ length: totalPages }, (_, page) => build(user, entries, page, totalPages, { ...display, mode }));
      return await pagination.paginate(interaction, pages, index);
    }
    if (["reach", "rank", "pp"].includes(command)) {
      const plays = integer("plays");
      const each = interaction.options.getNumber("each");
      if (plays !== null && each !== null) throw new Error("Specify either `plays` or `each`, not both.");
      let targetPP;
      let targetPlayer = null;
      if (command === "reach") {
        const targetUser = string("target_user")?.trim();
        if (!targetUser) throw new Error("Provide a target osu! player whose PP to reach.");
        const { target: reachTarget } = await resolveTarget(interaction, targetUser, mode);
        targetPlayer = await api.getUser(reachTarget, mode);
        targetPP = targetPlayer.statistics?.pp;
        if (!Number.isFinite(targetPP) || targetPP <= 0) throw new Error("Target player has no PP in this ruleset.");
      } else if (command === "rank") {
        const { rank, country } = parseRankTarget(string("rank"));
        const response = await api.getPerformanceRankings(mode, Math.ceil(rank / 50), country);
        const ranking = response.ranking?.[(rank - 1) % 50];
        if (!ranking) return interaction.editReply({ content: `Rank #${rank} not found in ${mode} rankings.` });
        targetPP = ranking.pp;
      } else {
        targetPP = interaction.options.getNumber("target_pp");
      }
      const scores = await api.getUserTopScores(user.id, mode);
      const result = calculateReach(scores, user.statistics?.pp ?? 0, targetPP, { plays, each });
      return interaction.editReply({ embeds: [embeds.reachEmbed(user, result, mode, targetPlayer, {
        ...display, kind: command === "rank" ? "Rank target" : command === "pp" ? "PP target" : "Reach",
        targetRank: command === "rank" ? string("rank") : null,
      })] });
    }
    if (command === "bws") {
      const override = integer("badges");
      const result = calculateBws(user.statistics?.global_rank, user.badges || [], mode, override);
      return interaction.editReply({ embeds: [embeds.bwsEmbed(user, result, mode, override !== null, display)] });
    }
    if (command === "whatif") {
      const newPP = interaction.options.getNumber("pp", true);
      const scores = await api.getUserTopScores(user.id, mode);
      return interaction.editReply({ content: embeds.whatIfMessage(user, scores, newPP, mode), allowedMentions: { parse: [] } });
    }
    if (command === "recent" || command === "top") {
      const scores = command === "recent"
        ? await api.getUserRecentScores(user.id, mode, interaction.options.getBoolean("include_fails") ?? true)
        : await api.getUserTopScores(user.id, mode);
      if (!scores.length) return interaction.editReply({ content: embeds.sourceErrorMessage(command, user.username, mode, true) });
      const requested = integer("index");
      const index = (requested ?? 1) - 1;
      if (index < 0 || index >= scores.length) return interaction.editReply({ content: `Choose an index between 1 and ${scores.length}.` });
      if (command === "recent") {
        const score = scores[index];
        // The original recent builder fetches the full map, rather than using
        // the compact map in the score response (notably its combo denominator).
        const map = await api.getBeatmap(score.beatmap_id ?? score.beatmap?.id);
        const enriched = await performance.enrichScore(score, map, mode);
        return interaction.editReply({
          content: embeds.recentHeader(user, mode),
          embeds: [embeds.scoreEmbed({ ...enriched, beatmap: map,
            beatmapset: map.beatmapset || score.beatmapset }, user, { ...sourceDisplay, mode,
            attemptNum: embeds.attemptNumber(scores, score.beatmap_id ?? score.beatmap?.id) })],
          allowedMentions: { parse: [] },
        });
      }
      const selectedScores = requested == null ? scores.slice(0, 5) : [{ ...scores[index], play_idx: index + 1 }];
      const beatmaps = new Map();
      const selected = await Promise.all(selectedScores.map(async score => {
        const id = score.beatmap_id ?? score.beatmap?.id;
        if (!beatmaps.has(id)) beatmaps.set(id, api.getBeatmap(id));
        return performance.enrichScore(score, await beatmaps.get(id), mode);
      }));
      const header = `${requested == null ? "Top" : "Number"} ${requested ?? selected.length} ${require("./sourceDataAdapter").modeText(mode)} Play${selected.length === 1 ? "" : "s"} for ${user.username}`;
      return interaction.editReply({ content: "", embeds: [embeds.scoreListEmbed(selected, user, { ...sourceDisplay, mode,
        header, pageInfo: [1, requested == null ? Math.ceil(scores.length / 5) : 1] })], allowedMentions: { parse: [] } });
    }
    if (command === "pinned") {
      const scores = await api.getUserPinnedScores(user.id, mode);
      if (!scores.length) return interaction.editReply({ content: `No ${command} scores found for this player in ${mode}.` });
      const index = (integer("index") ?? 1) - 1;
      if (index < 0 || index >= scores.length) return interaction.editReply({ content: `Choose an index between 1 and ${scores.length}.` });
      const beatmaps = new Map();
      const enriched = scores.slice();
      const pages = Array.from({ length: Math.ceil(scores.length / 5) }, (_, page) => async () => {
        const start = page * 5;
        await Promise.all(scores.slice(start, start + 5).map(async (score, offset) => {
          const id = score.beatmap_id ?? score.beatmap?.id;
          if (!beatmaps.has(id)) {
            const pending = api.getBeatmap(id).catch(error => { beatmaps.delete(id); throw error; });
            beatmaps.set(id, pending);
          }
          const map = await beatmaps.get(id);
          enriched[start + offset] = await performance.enrichScore(score, map, mode, { effectivePP: true });
        }));
        return embeds.pinnedEmbed(enriched, user, { ...display, mode, page });
      });
      return await pagination.paginate(interaction, pages, Math.floor(index / 5));
    }
    throw new Error("Unknown osu! subcommand.");
  } catch (error) {
    const status = error.response?.status;
    const content = status === 404 ? "That osu! user, beatmap, score, or match was not found."
      : error.isAxiosError || error.response ? "The osu! API is unavailable. Please try again later."
        : error.message;
    return interaction.editReply({ content, components: [], allowedMentions: { parse: [] } });
  }
}

module.exports = { executeOsu, parseResourceId, parseScoreResourceId, parseRankTarget };
