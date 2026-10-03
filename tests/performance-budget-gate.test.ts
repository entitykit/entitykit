import { spawnSync } from 'node:child_process';

function evaluate(body: string): number | null {
    return spawnSync(process.execPath, ['-e', `
        const { measure, pairedReadBudgets } = require('./benchmarks/workload-measurement');
        (async () => { ${body} })().catch(() => { process.exitCode = 1; });
    `], { encoding: 'utf8', timeout: 5_000 }).status;
}

describe('executable performance budget gate', () => {
    it('rejects work that exceeds the statement budget', () => {
        expect(evaluate(`
            const counters = { queries: 0, maxParameters: 0 };
            await measure('excess SQL', counters, async () => { counters.queries += 2; }, 1, 1);
        `)).toBe(1);
    });

    it('rejects missing telemetry instead of treating zero queries as efficient work', () => {
        expect(evaluate(`
            const counters = { queries: 0, maxParameters: 0 };
            await measure('unmeasured work', counters, async () => {}, 1, 1);
        `)).toBe(1);
    });

    it('rejects a breached paired read overhead budget', () => {
        expect(evaluate(`
            pairedReadBudgets(['find', 'materialize', 'include'].flatMap(area => [
                { name: 'raw.' + area, p95Ms: 1 }, { name: 'orm.' + area, p95Ms: 100 },
            ]));
        `)).toBe(1);
    });

    it('accepts measured work within its statement and latency budgets', () => {
        expect(evaluate(`
            const counters = { queries: 0, maxParameters: 0 };
            await measure('qualified work', counters, async () => { counters.queries += 1; }, 1, 1);
        `)).toBe(0);
    });
});
