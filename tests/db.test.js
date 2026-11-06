const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const pg = require("pg");

function setEnv(t, key, value) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

function setup(t, env = {}) {
  for (const key of ["DATABASE_URL", "DATABASE_SSL", "PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGPORT", "PGSSLMODE"]) {
    setEnv(t, key, env[key]);
  }
  const pools = [];
  class FakePool extends EventEmitter {
    constructor(config) {
      super();
      this.config = config;
      this.query = t.mock.fn(async () => ({ rows: [{ answer: 42 }], rowCount: 1 }));
      this.end = t.mock.fn(async () => {});
      pools.push(this);
    }
  }
  t.mock.method(pg, "Pool", FakePool);
  delete require.cache[require.resolve("../utils/db")];
  const db = require("../utils/db");
  t.after(() => db.close());
  return { db, pools };
}

test("unconfigured DB fails gracefully without creating a pool", async (t) => {
  const { db, pools } = setup(t);
  assert.equal(db.isConfigured(), false);
  assert.equal(db.getPool(), null);
  const result = await db.query("SELECT 1");
  assert.equal(result.error.message, "Database not configured");
  assert.deepEqual(result.rows, []);
  assert.equal(result.rowCount, 0);
  await db.close();
  assert.equal(pools.length, 0);
});

test("query forwards parameters and reuses the bounded pool", async (t) => {
  const { db, pools } = setup(t, { DATABASE_URL: "postgresql://app:password@localhost/carzusa" });
  assert.equal(db.isConfigured(), true);
  assert.deepEqual(await db.query("SELECT $1 AS answer", [42]), { error: null, rows: [{ answer: 42 }], rowCount: 1 });
  assert.deepEqual(pools[0].query.mock.calls[0].arguments, ["SELECT $1 AS answer", [42]]);
  assert.equal(db.getPool(), pools[0]);
  assert.equal(pools.length, 1);
  assert.deepEqual(pools[0].config, {
    connectionString: "postgresql://app:password@localhost/carzusa",
    max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000,
    statement_timeout: 5000, query_timeout: 5000,
  });
  await db.close();
  assert.equal(pools[0].end.mock.callCount(), 1);
});

test("PG variables work without a DATABASE_URL and idle errors have a handler", async (t) => {
  const { db, pools } = setup(t, { PGHOST: "localhost", PGDATABASE: "carzusa", PGUSER: "app" });
  const log = t.mock.method(console, "error", () => {});
  const pool = db.getPool();
  assert.equal(pools.length, 1);
  assert.equal(pool.config.connectionString, undefined);
  pool.emit("error", new Error("connection lost"));
  assert.equal(log.mock.callCount(), 1);
});

test("TLS URL modes and DATABASE_SSL keep the explicit no-verify policy", (t) => {
  for (const env of [
    { DATABASE_URL: "postgresql://app:password@db/carzusa?sslmode=require" },
    { DATABASE_URL: "postgresql://app:password@db/carzusa?sslmode=no-verify" },
    { DATABASE_URL: "postgresql://app:password@db/carzusa?sslmode=disable", DATABASE_SSL: "true" },
    { PGHOST: "db", PGSSLMODE: "require" },
    { PGHOST: "db", DATABASE_SSL: "true" },
  ]) {
    const { db } = setup(t, env);
    const pool = db.getPool();
    assert.deepEqual(pool.config.ssl, { rejectUnauthorized: false });
    assert.doesNotMatch(pool.config.connectionString || "", /sslmode/);
  }
});

test("query traps server and client timeout errors without rejecting", async (t) => {
  const { db } = setup(t, { PGHOST: "db" });
  const pool = db.getPool();
  for (const error of [Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }), new Error("Query read timeout")]) {
    pool.query.mock.mockImplementation(async () => { throw error; });
    const result = await db.query("SELECT pg_sleep(10)");
    assert.equal(result.error, error);
    assert.deepEqual(result.rows, []);
    assert.equal(result.rowCount, 0);
  }
});
