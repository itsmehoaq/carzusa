// One-off migration: keep the Supabase SDK outside the application's dependencies.
// npm install --prefix /tmp/carzusa-migration-sdk @supabase/supabase-js
// SUPABASE_MODULE_PATH=/tmp/carzusa-migration-sdk/node_modules/@supabase/supabase-js \
//   node scripts/migrate_supabase_to_postgres.js
// Run the final pass with the Supabase writer stopped. Do not rerun after cutover.
require("dotenv").config({ quiet: true });
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const db = require("../utils/db");

const fields = ["id", "guild_id", "tweet_key", "first_user_id", "first_channel_id",
  "first_message_id", "count", "created_at", "updated_at"];

function canonical(row) {
  return fields.map((field) => {
    const value = field === "updated_at" ? row.updated_at || row.created_at : row[field];
    if (value == null) return null;
    if (field.endsWith("_at")) return new Date(value).toISOString();
    return String(value);
  });
}

async function migrate() {
  assert.ok(process.env.SUPABASE_URL && process.env.SUPABASE_KEY, "Supabase credentials required");
  assert.ok(db.isConfigured(), "PostgreSQL configuration required");
  const { createClient } = require(process.env.SUPABASE_MODULE_PATH || "@supabase/supabase-js");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { count: sourceCount, error: countError } = await supabase
    .from("twitter_reposts").select("*", { count: "exact", head: true });
  if (countError) throw new Error(`Source count failed: ${countError.message}`);
  assert.ok(sourceCount >= 16418, `Unexpected source count: ${sourceCount}`);

  const sourceRows = [];
  for (let from = 0; from < sourceCount; from += 1000) {
    const { data, error } = await supabase.from("twitter_reposts")
      .select("*").order("id", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`Source page ${from} failed: ${error.message}`);
    assert.ok(data.length > 0, `Source page ${from} unexpectedly empty`);
    sourceRows.push(...data);
  }
  assert.equal(sourceRows.length, sourceCount, "Source changed during paging; rerun with writer stopped");
  assert.equal(new Set(sourceRows.map((row) => String(row.id))).size, sourceCount, "Duplicate source IDs");
  for (const row of sourceRows) {
    assert.ok(typeof row.id === "string" || Number.isSafeInteger(row.id), "Source ID exceeds JS integer precision");
  }

  const client = await db.getPool().connect();
  try {
    const { rows: [target] } = await client.query("SELECT current_database() AS name");
    assert.equal(target.name, "carzusa", "Refusing to migrate into another database");
    await client.query("BEGIN");
    for (let from = 0; from < sourceRows.length; from += 1000) {
      await client.query(`
        INSERT INTO twitter_reposts (${fields.join(", ")})
        SELECT id, guild_id, tweet_key, first_user_id, first_channel_id, first_message_id,
               count, created_at, COALESCE(updated_at, created_at)
        FROM jsonb_to_recordset($1::jsonb) AS source(
          id bigint, guild_id text, tweet_key text, first_user_id text,
          first_channel_id text, first_message_id text, count integer,
          created_at timestamptz, updated_at timestamptz)
        ON CONFLICT (guild_id, tweet_key) DO UPDATE SET
          id = EXCLUDED.id, first_user_id = EXCLUDED.first_user_id,
          first_channel_id = EXCLUDED.first_channel_id, first_message_id = EXCLUDED.first_message_id,
          count = EXCLUDED.count, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [JSON.stringify(sourceRows.slice(from, from + 1000))]);
    }
    const { rows: destinationRows } = await client.query("SELECT * FROM twitter_reposts ORDER BY id");
    assert.equal(destinationRows.length, sourceCount, "Destination row count mismatch");
    const hash = createHash("sha256");
    for (let i = 0; i < sourceRows.length; i++) {
      const expected = canonical(sourceRows[i]);
      assert.deepEqual(canonical(destinationRows[i]), expected, `Mismatch for source row ${sourceRows[i].id}`);
      hash.update(JSON.stringify(expected) + "\n");
    }
    const { count: finalSourceCount, error } = await supabase
      .from("twitter_reposts").select("*", { count: "exact", head: true });
    if (error) throw new Error(`Final source count failed: ${error.message}`);
    assert.equal(finalSourceCount, sourceCount, "Source changed during migration; rerun with writer stopped");
    await client.query(`SELECT setval(pg_get_serial_sequence('twitter_reposts', 'id'),
      COALESCE((SELECT MAX(id) FROM twitter_reposts), 1))`);
    await client.query("COMMIT");
    console.log(JSON.stringify({ sourceCount, destinationCount: destinationRows.length,
      verifiedRows: destinationRows.length, sha256: hash.digest("hex") }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  }).finally(() => db.close());
}

module.exports = { migrate };
