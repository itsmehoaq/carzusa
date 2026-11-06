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
  if (name === "whatif") builder.addNumberOption((option) => option.setName("pp").setDescription("PP of the hypothetical new play").setRequired(true).setMinValue(0));
  addTarget(builder, name === "link");
  if (name === "recent") builder.addBooleanOption((option) => option.setName("include_fails").setDescription("Include failed plays (default: true)"));
  if (["recent", "top"].includes(name)) builder.addIntegerOption((option) => option.setName("index").setDescription("Play number to display first (default: 1)").setMinValue(1).setMaxValue(name === "recent" ? 50 : 100));
  if (name === "bws") builder.addIntegerOption((option) => option.setName("badges").setDescription("Override the tournament badge count").setMinValue(0).setMaxValue(100));
  return builder;
}

module.exports = { configureCommand, DESCRIPTIONS };
