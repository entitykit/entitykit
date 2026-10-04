const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function qualificationTarget(provider, variable = 'ENTITYKIT_OPERATION_DATABASE_URL') {
  if (provider === 'sqlite') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'entitykit-provider-qualification-'));
    return { target: path.join(directory, 'qualification.db'), cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
  }
  assert.ok(['postgres', 'mysql'].includes(provider), 'Choose sqlite, postgres, or mysql.');
  const target = process.env[variable];
  assert.ok(target, `${variable} must name an isolated qualification database.`);
  assert.match(new URL(target).pathname, /test|qualification|hardening/u, 'Refuse to modify an application database.');
  return { target, cleanup() {} };
}

function qualificationSource(provider, target, maximum = 1, options = {}) {
  if (provider === 'postgres') return require('@entitykit/postgres').createPostgresDataSource({
    connectionString: target, pool: { max: maximum, connectionTimeoutMs: 2_000 },
  }, options);
  if (provider === 'mysql') return require('@entitykit/mysql').createMySqlDataSource({
    connectionString: target, connectTimeoutMs: 2_000, pool: { max: maximum },
  }, options);
  return require('@entitykit/sqlite').createSqliteDataSource({ filename: target, busyTimeoutMs: 100 });
}

async function within(pending, milliseconds = 2_000, description = 'provider operation') {
  let timer;
  try {
    return await Promise.race([pending, new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${description} exceeded ${milliseconds}ms.`)), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function withConnection(source, work) {
  const connection = source.createConnection();
  try { return await work(connection); }
  finally { await connection.dispose(); }
}

const statement = text => ({ text, values: [] });

module.exports = { qualificationTarget, qualificationSource, within, withConnection, statement };
