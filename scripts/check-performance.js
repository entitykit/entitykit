const { spawnSync } = require('node:child_process');
const path = require('node:path');

const result = spawnSync(process.execPath, ['--expose-gc', '--unhandled-rejections=strict',
  path.join(__dirname, '..', 'benchmarks', 'run.js'), process.argv[2] ?? 'sqlite'], {
  encoding: 'utf8', timeout: 90_000, env: process.env,
});
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) console.error('Performance qualification did not exit within its resource budget.');
process.exitCode = result.status === 0 && !result.error ? 0 : 1;
