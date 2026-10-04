const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

function execute(binary, arguments_) {
  return new Promise((resolve, reject) => execFile(binary, arguments_, { timeout: 30_000, maxBuffer: 1024 * 1024 },
    (error, stdout) => error ? reject(new Error('Isolated database server control failed.')) : resolve(stdout)));
}

async function qualificationServerController(provider, target) {
  const address = new URL(target);
  assert.ok(['127.0.0.1', 'localhost'].includes(address.hostname), 'Server recovery requires an isolated loopback service.');
  assert.match(address.pathname, /test|qualification|hardening/u);
  const container = process.env.ENTITYKIT_CRASH_CONTAINER;
  if (container) {
    const inspected = JSON.parse(await execute('docker', ['inspect', container]))[0];
    const serverPort = provider === 'postgres' ? '5432/tcp' : '3306/tcp';
    const bindings = inspected.NetworkSettings.Ports[serverPort] ?? [];
    assert.ok(bindings.some(binding => binding.HostPort === address.port), 'Container must own the target port.');
    assert.match(inspected.Config.Image, provider === 'postgres' ? /(?:^|\/)postgres:18/u : /(?:^|\/)mysql:8\.4/u);
    const databaseVariable = provider === 'postgres' ? 'POSTGRES_DB' : 'MYSQL_DATABASE';
    assert.ok(inspected.Config.Env.includes(`${databaseVariable}=${address.pathname.slice(1)}`), 'Container database must match the isolated target.');
    return async () => {
      await execute('docker', ['kill', '--signal', 'KILL', inspected.Id]);
      await execute('docker', ['start', inspected.Id]);
    };
  }
  assert.equal(provider, 'postgres', 'MySQL server recovery requires an explicit qualification container.');
  const directory = fs.realpathSync(process.env.ENTITYKIT_CRASH_POSTGRES_DATA ?? '');
  assert.ok(directory.startsWith(`${fs.realpathSync('/tmp')}${path.sep}entitykit-hardening-postgres.`),
    'Native server control is restricted to this task\'s temporary Postgres cluster.');
  const binary = process.env.ENTITYKIT_CRASH_POSTGRES_CTL;
  assert.equal(path.basename(binary ?? ''), 'pg_ctl');
  const pidFile = fs.readFileSync(path.join(directory, 'postmaster.pid'), 'utf8').split('\n');
  assert.equal(fs.realpathSync(pidFile[1]), directory);
  assert.equal(pidFile[3], address.port, 'Native Postgres must own the target port.');
  assert.match(pidFile[4], /^\/[A-Za-z0-9_./-]+$/u, 'Native qualification socket path must be safe to restore.');
  return async () => {
    await execute(binary, ['stop', '-D', directory, '-m', 'immediate', '-w', '-t', '20']);
    await execute(binary, ['start', '-D', directory, '-l', path.join(directory, 'server.log'),
      '-o', `-h127.0.0.1 -p${address.port} -k${pidFile[4]}`, '-w', '-t', '20']);
  };
}

module.exports = { qualificationServerController };
