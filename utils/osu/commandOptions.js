const { MODES } = require("./osuTargetResolver");

const DESCRIPTIONS = {
  profile: "Show an osu! player profile",
  recent: "Show recent osu! scores",
  top: "Show top osu! scores",
  map: "Show a beatmap's raw attributes",
  whatif: "Estimate total PP after a hypothetical play",
  bws: "Calculate badge-weighted seeding rank",
  matchcost: "Evaluate player performance in a multiplayer match",
  link: "Link an osu! account and choose your default ruleset",
  unlink: "Remove your osu! account link",
  avatar: "Show an osu! player's avatar",
  pinned: "Show pinned osu! scores",
  mostplayed: "Show a player's most-played beatmaps",
  checkname: "Check estimated osu! username release eligibility",
  badge: "Show all osu! profile badges",
  reach: "Estimate plays needed to reach another player's PP",
  rank: "Estimate plays needed to reach a global or country rank",
  pp: "Estimate plays needed to reach a PP target",
  scorepost: "Generate an r/osugame scorepost title",
};

function addTarget(builder, required = false) {
  return builder.addStringOption((option) => option.setName("username")
    .setDescription(required ? "osu! username or ID" : "osu! username, ID, or Discord mention; defaults to your linked account")
    .setRequired(required))
    .addStringOption((option) => option.setName("mode").setDescription("Ruleset; defaults to your linked preference")
      .addChoices(...MODES.map((mode) => ({ name: { osu: "osu!standard", taiko: "osu!taiko", fruits: "osu!catch", mania: "osu!mania" }[mode], value: mode }))));
}

function configureCommand(builder, name) {
  builder.setDescription(DESCRIPTIONS[name]);
  if (name === "map") return builder.addStringOption((option) => option.setName("beatmap_id_or_url").setDescription("Beatmap ID or URL to a specific difficulty").setRequired(true));
  if (name === "matchcost") return builder
    .addStringOption((option) => option.setName("match_id_or_url").setDescription("osu! multiplayer match ID or URL").setRequired(true))
    .addIntegerOption((option) => option.setName("warmups").setDescription("Number of warmup maps to remove from the start").setMinValue(0))
    .addIntegerOption((option) => option.setName("skip").setDescription("Number of maps to remove from the end").setMinValue(0))
    .addNumberOption((option) => option.setName("ez").setDescription("EZ score multiplier (default: 1.78)").setMinValue(0.01).setMaxValue(10));
  if (name === "unlink") return builder;
  if (name === "checkname") return builder.addStringOption((option) => option.setName("query").setDescription("Exact username to check").setRequired(true));
  if (name === "scorepost") return builder.addStringOption((option) => option.setName("score_id_or_url").setDescription("Score ID or modern/legacy osu! score URL").setRequired(true));
  if (name === "reach") builder.addStringOption((option) => option.setName("target_user").setDescription("Player whose PP to reach").setRequired(true));
  if (name === "pp") builder.addNumberOption((option) => option.setName("target_pp").setDescription("Total PP to reach").setRequired(true).setMinValue(0));
  if (name === "rank") builder.addStringOption((option) => option.setName("rank").setDescription("Global rank (#50) or country rank (VN50 or VN#50), up to 10,000").setRequired(true));
  if (name === "whatif") builder.addNumberOption((option) => option.setName("pp").setDescription("PP of the hypothetical new play").setRequired(true).setMinValue(0));
  addTarget(builder, name === "link");
  if (name === "recent") builder.addBooleanOption((option) => option.setName("include_fails").setDescription("Include failed plays (default: true)"));
  if (["recent", "top", "pinned"].includes(name)) builder.addIntegerOption((option) => option.setName("index").setDescription("Play number to display first (default: 1)").setMinValue(1).setMaxValue(name === "recent" ? 50 : 100));
  if (["mostplayed", "badge"].includes(name)) builder.addIntegerOption((option) => option.setName("page").setDescription("Page to display first (default: 1)").setMinValue(1));
  if (["reach", "rank", "pp"].includes(name)) builder
    .addIntegerOption((option) => option.setName("plays").setDescription("Fixed number of new plays (use either plays or each)").setMinValue(1).setMaxValue(100))
    .addNumberOption((option) => option.setName("each").setDescription("PP per new play (use either plays or each)").setMinValue(0.01).setMaxValue(50000));
  if (name === "bws") builder.addIntegerOption((option) => option.setName("badges").setDescription("Override the tournament badge count").setMinValue(0).setMaxValue(100));
  return builder;
}

module.exports = { configureCommand, DESCRIPTIONS };
