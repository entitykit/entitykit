const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

// npm's workspace PATH can select the root ESLint when a workspace bin link is
// absent. Resolve the workspace's declared version before running its plugins.
const workspaceRequire = createRequire(path.join(process.cwd(), 'package.json'));
const cli = path.join(path.dirname(workspaceRequire.resolve('eslint/package.json')), 'bin/eslint.js');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
