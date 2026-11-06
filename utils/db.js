const { Pool } = require("pg");

let pool;

function isConfigured() {
  return Boolean(process.env.DATABASE_URL || process.env.PGHOST || process.env.PGDATABASE || process.env.PGUSER);
}

function getPool() {
  if (!isConfigured()) return null;
  if (pool) return pool;

  const config = {
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 5000,
  };
  let sslMode = process.env.PGSSLMODE;
  let url;
  if (process.env.DATABASE_URL) {
    url = new URL(process.env.DATABASE_URL);
    sslMode = url.searchParams.get("sslmode") || sslMode;
    config.connectionString = url.toString();
  }
  if (["require", "no-verify"].includes(sslMode) || process.env.DATABASE_SSL === "true") {
    config.ssl = { rejectUnauthorized: false };
    // pg parses URL SSL options after the config object. Keep our explicit policy.
    if (url) {
      for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
      config.connectionString = url.toString();
    }
  }

  pool = new Pool(config);
  pool.on("error", (error) => {
    console.error("PostgreSQL idle client error:", error.message);
  });
  return pool;
}

async function query(text, params) {
  try {
    const activePool = getPool();
    if (!activePool) throw new Error("Database not configured");
    return { ...await activePool.query(text, params), error: null };
  } catch (error) {
    return { error, rows: [], rowCount: 0 };
  }
}

async function close() {
  if (!pool) return;
  const activePool = pool;
  pool = undefined;
  await activePool.end();
}

module.exports = { query, close, isConfigured, getPool };
