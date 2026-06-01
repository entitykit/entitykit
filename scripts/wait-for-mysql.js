#!/usr/bin/env node

const mysql = require("mysql2/promise");

const databaseUrl = process.argv[2] ??
  process.env.MYSQL_URL ??
  process.env.MYSQL_DATABASE_URL;
const maxAttempts = Number.parseInt(
  process.env.ENTITYKIT_MYSQL_WAIT_ATTEMPTS ?? "30",
  10
);
const retryDelayMs = Number.parseInt(
  process.env.ENTITYKIT_MYSQL_WAIT_DELAY_MS ?? "1000",
  10
);

if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
  console.error("MYSQL_URL, MYSQL_DATABASE_URL, or a database URL argument is required.");
  process.exit(1);
}

waitForMysql().catch(error => {
  console.error(error.message);
  process.exit(1);
});

async function waitForMysql() {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await ping(databaseUrl);
      console.log(`MySQL is ready: ${redactPassword(databaseUrl)}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await delay(retryDelayMs);
      }
    }
  }

  throw new Error(
    `MySQL did not become ready after ${maxAttempts} attempts: ${lastError?.message ?? "unknown error"}`
  );
}

async function ping(connectionUri) {
  const connection = await mysql.createConnection(connectionUri);
  try {
    await connection.query("select 1");
  } finally {
    await connection.end().catch(() => undefined);
  }
}

function redactPassword(connectionUri) {
  try {
    const url = new URL(connectionUri);
    if (url.password) {
      url.password = "****";
    }
    return url.toString();
  } catch {
    return connectionUri;
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
