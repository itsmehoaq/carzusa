const api = require("./osuClient");
const db = require("./osuDb");
const { resolveTarget } = require("./osuTargetResolver");
const { calculateBws } = require("./calculations/bws");
const { calculateWhatIf } = require("./calculations/whatIf");
const { evaluateMatchCost } = require("./calculations/matchCost");
const embeds = require("./embeds");
const pagination = require("./paginationHelper");

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

async function executeOsu(interaction, alias = null) {
  // This must precede option resolution, database lookups, and HTTP requests for every entry point.
  await interaction.deferReply();
  try {
    const command = alias || interaction.options.getSubcommand();
    const string = (name) => interaction.options.getString(name);
    const integer = (name) => interaction.options.getInteger(name);
    if (command === "unlink") {
      const removed = await db.unlinkUser(interaction.user.id);
      return interaction.editReply({ content: removed ? "Your osu! account link has been removed." : "Could not remove your link. The database is unavailable." });
    }
    if (command === "link") {
      const mode = string("mode") || "osu";
      const user = await api.getUser(string("username"), mode);
      const linked = await db.linkUser(interaction.user.id, user.id, user.username, mode);
      return interaction.editReply({
        content: linked ? `Linked osu! account ${user.username} (default ruleset: ${mode}).` : "Could not save your link. The database is unavailable.",
        allowedMentions: { parse: [] },
      });
    }
    if (command === "map") {
      const map = await api.getBeatmap(parseResourceId(string("beatmap_id_or_url"), "beatmap"));
      return interaction.editReply({ embeds: [embeds.beatmapEmbed(map)] });
    }
    if (command === "matchcost") {
      const match = await api.getMatch(parseResourceId(string("match_id_or_url"), "match"));
      const result = evaluateMatchCost(match, {
        warmups: integer("warmups") ?? 0, skip: integer("skip") ?? 0, ez: interaction.options.getNumber("ez") ?? 1.78,
      });
      const pages = Array.from({ length: Math.max(1, Math.ceil(result.players.length / 15)) }, (_, page) => embeds.matchCostEmbed(result, page));
      return await pagination.paginate(interaction, pages);
    }

    const { target, mode } = await resolveTarget(interaction, string("username"), string("mode"));
    const user = await api.getUser(target, mode);
    if (command === "profile") return interaction.editReply({ embeds: [embeds.profileEmbed(user, mode)] });
    if (command === "bws") {
      const override = integer("badges");
      const result = calculateBws(user.statistics?.global_rank, user.badges || [], mode, override);
      return interaction.editReply({ embeds: [embeds.bwsEmbed(user, result, mode, override !== null)] });
    }
    if (command === "whatif") {
      const newPP = interaction.options.getNumber("pp", true);
      const scores = await api.getUserTopScores(user.id, mode);
      const result = calculateWhatIf(scores, newPP, user.statistics?.pp ?? 0);
      return interaction.editReply({ embeds: [embeds.whatIfEmbed(user, result, newPP, mode)] });
    }
    if (command === "recent" || command === "top") {
      const scores = command === "recent"
        ? await api.getUserRecentScores(user.id, mode, interaction.options.getBoolean("include_fails") ?? true)
        : await api.getUserTopScores(user.id, mode);
      if (!scores.length) return interaction.editReply({ content: `No ${command} scores found for this player in ${mode}.` });
      const index = (integer("index") ?? 1) - 1;
      if (index < 0 || index >= scores.length) return interaction.editReply({ content: `Choose an index between 1 and ${scores.length}.` });
      // Fetch missing object counts only when needed to compute a failed play's completion.
      const beatmaps = new Map();
      const enriched = await Promise.all(scores.map(async (score) => {
        if (!score.failed || score.completion !== null || !score.beatmap?.id) return score;
        const id = score.beatmap.id;
        if (!beatmaps.has(id)) beatmaps.set(id, api.getBeatmap(id));
        const map = await beatmaps.get(id);
        return { ...score, completion: api.normalizeScore({ ...score, beatmap: { ...map, ...score.beatmap } }).completion };
      }));
      const pages = enriched.map((score, page) => embeds.scoreEmbed(score, user, {
        mode, kind: command === "recent" ? "Recent" : "Top", index: page, total: scores.length,
      }));
      return await pagination.paginate(interaction, pages, index);
    }
    throw new Error("Unknown osu! subcommand.");
  } catch (error) {
    const status = error.response?.status;
    const content = status === 404 ? "That osu! user, beatmap, or match was not found."
      : error.isAxiosError || error.response ? "The osu! API is unavailable. Please try again later."
        : error.message;
    return interaction.editReply({ content, components: [], allowedMentions: { parse: [] } });
  }
}

module.exports = { executeOsu, parseResourceId };
