const assert = require("node:assert/strict");
const { test } = require("node:test");
const db = require("../utils/db");
const osuDb = require("../utils/osu/osuDb");

const linked = { discord_id: "123", osu_id: "456", osu_username: "O'Brien", default_mode: "mania" };

test("linked user lookup selects only the link fields with a bound Discord ID", async (t) => {
  const query = t.mock.method(db, "query", async () => ({ rows: [linked], error: null }));
  assert.deepEqual(await osuDb.getLinkedUser("123"), linked);
  assert.match(query.mock.calls[0].arguments[0], /SELECT discord_id, osu_id, osu_username, default_mode FROM osu_users WHERE discord_id = \$1/);
  assert.deepEqual(query.mock.calls[0].arguments[1], ["123"]);
  query.mock.mockImplementation(async () => ({ rows: [], error: null }));
  assert.equal(await osuDb.getLinkedUser("missing"), null);
});

test("link upserts the username, mode and updated timestamp using parameters", async (t) => {
  const query = t.mock.method(db, "query", async () => ({ rows: [linked], error: null }));
  assert.deepEqual(await osuDb.linkUser("123", 456, "O'Brien", "mania"), linked);
  const [sql, params] = query.mock.calls[0].arguments;
  assert.match(sql, /ON CONFLICT \(discord_id\) DO UPDATE/);
  assert.match(sql, /updated_at = NOW\(\)/);
  assert.doesNotMatch(sql, /O'Brien/);
  assert.deepEqual(params, ["123", 456, "O'Brien", "mania"]);
  await osuDb.linkUser("123", 456, "name");
  assert.equal(query.mock.calls[1].arguments[1][3], "osu");
});

test("unlink is idempotent and deletes only the requested Discord user's link", async (t) => {
  const query = t.mock.method(db, "query", async () => ({ rows: [], rowCount: 0, error: null }));
  assert.equal(await osuDb.unlinkUser("123"), true);
  assert.deepEqual(query.mock.calls[0].arguments, ["DELETE FROM osu_users WHERE discord_id = $1", ["123"]]);
});

test("unconfigured, failed, and rejected queries return graceful read/write failures", async (t) => {
  const query = t.mock.method(db, "query", async () => ({ rows: [], error: new Error("Database not configured") }));
  for (const rejects of [false, true]) {
    if (rejects) query.mock.mockImplementation(async () => { throw new Error("connection failure"); });
    assert.equal(await osuDb.getLinkedUser("123"), null);
    assert.equal(await osuDb.linkUser("123", 456, "name"), null);
    assert.equal(await osuDb.unlinkUser("123"), false);
  }
});
