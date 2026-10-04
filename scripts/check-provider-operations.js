const { spawnSync } = require('node:child_process');
const path = require('node:path');

const result = spawnSync(process.execPath, ['--unhandled-rejections=strict',
  path.join(__dirname, 'qualify-provider-operations.js'), process.argv[2] ?? 'sqlite'], {
  encoding: 'utf8', timeout: 30_000, env: process.env,
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) console.error('Provider qualification failed to exit within its process resource budget.');
process.exitCode = result.status === 0 && !result.error ? 0 : 1;
