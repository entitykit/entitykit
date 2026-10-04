const { spawnSync } = require('node:child_process');
const path = require('node:path');

const result = spawnSync(process.execPath, ['--unhandled-rejections=strict',
  path.join(__dirname, 'qualify-server-recovery.js'), process.argv[2]], {
  encoding: 'utf8', timeout: 90_000, env: process.env,
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) console.error('Server recovery qualification exceeded its process resource budget.');
process.exitCode = result.status === 0 && !result.error ? 0 : 1;
