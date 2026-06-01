#!/usr/bin/env node

const { Client } = require("pg");

const databaseUrl = process.argv[2] ?? process.env.DATABASE_URL;
const maxAttempts = Number.parseInt(process.env.ENTITYKIT_POSTGRES_WAIT_ATTEMPTS ?? "30", 10);
const retryDelayMs = Number.parseInt(process.env.ENTITYKIT_POSTGRES_WAIT_DELAY_MS ?? "1000", 10);
const createDatabase = process.env.ENTITYKIT_CREATE_DATABASE === "true";

if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
  console.error("DATABASE_URL or a database URL argument is required.");
  process.exit(1);
}

waitForPostgres().catch(error => {
  console.error(error.message);
  process.exit(1);
});

async function waitForPostgres() {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await ping(databaseUrl);
      console.log(`Postgres is ready: ${redactPassword(databaseUrl)}`);
      return;
    } catch (error) {
      lastError = error;

      if (createDatabase && error.code === "3D000") {
        await createTargetDatabase(databaseUrl);
        continue;
      }

      if (attempt < maxAttempts) {
        await delay(retryDelayMs);
      }
    }
  }

  throw new Error(`Postgres did not become ready after ${maxAttempts} attempts: ${lastError?.message ?? "unknown error"}`);
}

async function ping(connectionString) {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query("select 1");
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function createTargetDatabase(connectionString) {
  const target = new URL(connectionString);
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));

  if (!databaseName) {
    throw new Error("Unable to create database because the target URL has no database name.");
  }

  target.pathname = "/postgres";

  const client = new Client({ connectionString: target.toString() });
  try {
    await client.connect();
    await client.query(`create database ${quoteIdentifier(databaseName)}`);
    console.log(`Created Postgres database: ${databaseName}`);
  } catch (error) {
    if (error.code !== "42P04") {
      throw error;
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

function redactPassword(connectionString) {
  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = "****";
    }
    return url.toString();
  } catch {
    return connectionString;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
