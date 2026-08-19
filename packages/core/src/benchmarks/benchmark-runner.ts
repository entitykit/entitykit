import { performance } from 'node:perf_hooks';

export interface BenchmarkCase {
    readonly name: string;
    readonly iterations: number;
    readonly warmupIterations?: number;
    run(): Promise<void> | void;
}

export interface BenchmarkResult {
    readonly name: string;
    readonly iterations: number;
    readonly totalMs: number;
    readonly averageMs: number;
    readonly operationsPerSecond: number;
}

export async function runBenchmarkCase(testCase: BenchmarkCase): Promise<BenchmarkResult> {
    const warmupIterations = testCase.warmupIterations ?? Math.min(10, testCase.iterations);

    for (let index = 0; index < warmupIterations; index++) {
        await testCase.run();
    }

    const startedAt = performance.now();
    for (let index = 0; index < testCase.iterations; index++) {
        await testCase.run();
    }
    const totalMs = performance.now() - startedAt;
    const averageMs = totalMs / testCase.iterations;

    return {
        name: testCase.name,
        iterations: testCase.iterations,
        totalMs,
        averageMs,
        operationsPerSecond: averageMs === 0 ? Number.POSITIVE_INFINITY : 1000 / averageMs,
    };
}

export async function runBenchmarkSuite(testCases: readonly BenchmarkCase[]): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    for (const testCase of testCases) {
        results.push(await runBenchmarkCase(testCase));
    }
    return results;
}

export function formatBenchmarkResults(results: readonly BenchmarkResult[]): string {
    const lines = ['Benchmark results', '================='];
    for (const result of results) {
        lines.push(`${result.name}: ${result.averageMs.toFixed(3)}ms/op (${result.operationsPerSecond.toFixed(0)} ops/sec, ${String(result.iterations)} iterations)`);
    }
    return lines.join('\n');
}
