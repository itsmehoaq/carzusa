const db = require("../db");

// A failed lookup is indistinguishable from a missing link; writes explicitly report failure.
async function getLinkedUser(discordId) {
  try {
    const result = await db.query(
      "SELECT discord_id, osu_id, osu_username, default_mode FROM osu_users WHERE discord_id = $1",
      [discordId],
    );
    return result.error ? null : result.rows[0] || null;
  } catch {
    return null;
  }
}

async function linkUser(discordId, osuId, osuUsername, defaultMode = "osu") {
  try {
    const result = await db.query(
      `INSERT INTO osu_users (discord_id, osu_id, osu_username, default_mode)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (discord_id) DO UPDATE SET osu_id = EXCLUDED.osu_id,
       osu_username = EXCLUDED.osu_username, default_mode = EXCLUDED.default_mode, updated_at = NOW()
       RETURNING discord_id, osu_id, osu_username, default_mode`,
      [discordId, osuId, osuUsername, defaultMode],
    );
    return result.error ? null : result.rows[0] || null;
  } catch {
    return null;
  }
}

async function unlinkUser(discordId) {
  try {
    const result = await db.query("DELETE FROM osu_users WHERE discord_id = $1", [discordId]);
    return !result.error;
  } catch {
    return false;
  }
}

module.exports = { getLinkedUser, linkUser, unlinkUser };
