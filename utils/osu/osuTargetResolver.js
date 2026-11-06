const db = require("./osuDb");

const MODES = ["osu", "taiko", "fruits", "mania"];

async function resolveTarget(interaction, username = null, explicitMode = null) {
  const input = username?.trim();
  const mention = input?.match(/^<@!?(\d+)>$/);
  const linked = await db.getLinkedUser(mention ? mention[1] : interaction.user.id);
  const target = mention || !input ? linked?.osu_id || linked?.osu_username : input;
  if (!target) throw new Error(mention ? "That Discord user has no linked osu! account." : "Provide an osu! username or link your account with /osu link.");
  const mode = explicitMode || linked?.default_mode || "osu";
  if (!MODES.includes(mode)) throw new Error("Choose a valid osu! ruleset.");
  return { target, mode };
}

module.exports = { resolveTarget, MODES };
