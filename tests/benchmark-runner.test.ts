import { formatBenchmarkResults, runBenchmarkCase, runBenchmarkSuite } from '../src/benchmarks/benchmark-runner';

describe('benchmark runner', () => {
    it('runs benchmark cases and formats results', async () => {
        let calls = 0;

        const result = await runBenchmarkCase({
            name: 'noop',
            iterations: 3,
            warmupIterations: 2,
            run() {
                calls++;
            },
        });

        expect(calls).toBe(5);
        expect(result.name).toBe('noop');
        expect(result.iterations).toBe(3);
        expect(result.averageMs).toBeGreaterThanOrEqual(0);
        expect(formatBenchmarkResults([result])).toContain('noop');
    });

    it('runs benchmark suites sequentially', async () => {
        const order: string[] = [];

        const results = await runBenchmarkSuite([
            { name: 'first', iterations: 1, warmupIterations: 0, run: () => {
                order.push('first');
            } },
            { name: 'second', iterations: 1, warmupIterations: 0, run: () => {
                order.push('second');
            } },
        ]);

        expect(order).toEqual(['first', 'second']);
        expect(results.map(result => result.name)).toEqual(['first', 'second']);
    });
});
