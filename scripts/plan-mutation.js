const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { mutationPlan } = require('./mutation-campaigns');

const mode = process.argv[2];
const root = process.cwd();
const base = process.env.MUTATION_BASE_SHA;
const head = process.env.MUTATION_HEAD_SHA;
let changed = [];
if (mode === 'pr') {
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || base === '0'.repeat(40)) {
    changed = ['package.json'];
  } else {
    if (!/^[\da-f]{40}$/u.test(base ?? '') || !/^[\da-f]{40}$/u.test(head ?? '')) {
      throw new Error('Focused mutation planning requires valid base and head commit SHAs.');
    }
    changed = execFileSync('git', ['diff', '--name-only', '-z', `${base}...${head}`], { encoding: 'utf8' })
      .split('\0').filter(Boolean);
  }
}
const plan = { ...mutationPlan(root, mode, changed), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() };
fs.mkdirSync('coverage/mutation', { recursive: true });
fs.writeFileSync('coverage/mutation/plan.json', `${JSON.stringify(plan, null, 2)}\n`);
if (process.env.GITHUB_OUTPUT) {
  // An empty matrix is represented by a skipped placeholder; the gate still
  // verifies the empty plan and reports a successful docs-only check.
  const include = plan.jobs.length ? plan.jobs : [{ id: 'none' }];
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include })}\nmode=${mode}\nhas-work=${plan.jobs.length > 0}\n`);
}
console.log(`Mutation plan: ${mode}, ${plan.jobs.length} jobs at ${plan.commit}.`);
if (plan.deferred.length) console.log('The broad core campaign runs nightly and for every release.');
