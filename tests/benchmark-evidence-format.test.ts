import { createRequire } from 'node:module';

const loadModule = createRequire(__filename);

interface BenchmarkComparison {
    area: string;
    rawPerOperationMs: number;
    entityKitPerOperationMs: number;
    ratio: number;
    extraPerOperationMs: number;
}

interface BenchmarkSummary {
    group: string;
    cases: number;
    bestPerOperationMs: number;
    slowestPerOperationMs: number;
}

interface BenchmarkEvidenceModule {
    readonly formatBenchmarkEvidence: (
        environment: Readonly<Record<string, string>>,
        results: readonly BenchmarkResult[],
    ) => string;
    readonly summarizeBenchmarkComparisons: (
        results: readonly BenchmarkResult[],
    ) => BenchmarkComparison[];
    readonly summarizeBenchmarkResults: (
        results: readonly BenchmarkResult[],
    ) => BenchmarkSummary[];
}

const {
    formatBenchmarkEvidence,
    summarizeBenchmarkComparisons,
    summarizeBenchmarkResults,
} = loadModule('../benchmarks/evidence-format') as BenchmarkEvidenceModule;

interface BenchmarkResult {
    name: string;
    iterations: number;
    totalMs: number;
    perOperationMs: number;
    operationsPerSecond: number;
}

function result(name: string, perOperationMs: number): BenchmarkResult {
    return {
        name,
        iterations: 10,
        totalMs: perOperationMs * 10,
        perOperationMs,
        operationsPerSecond: 1000 / perOperationMs,
    };
}

describe('benchmark evidence formatter', () => {
    it('ranks raw baseline comparisons by largest local overhead', () => {
        const comparisons = summarizeBenchmarkComparisons([
            result('raw pg: select by id', 1),
            result('EntityKit: DbSet.find by id', 2),
            result('raw pg: insert batch', 4),
            result('EntityKit: saveChanges insert batch', 10),
            result('raw pg: update by id', 1),
            result('EntityKit: saveChanges attached update', 5),
            result('raw pg: select then update by id', 2),
            result('EntityKit: saveChanges update', 7),
            result('raw pg: many-to-many link batch', 7),
            result('raw pg: many-to-many link batch transaction', 9),
            result('EntityKit: saveChanges many-to-many link batch', 10),
        ]);

        expect(comparisons.map((comparison: { area: string }) => comparison.area)).toEqual([
            'save insert batch',
            'tracked save update',
            'attached save update',
            'many-to-many link batch',
            'primary-key lookup',
            'many-to-many link batch transaction-normalized',
        ]);
        expect(comparisons.slice(-1)[0]?.area).toBe('many-to-many link batch transaction-normalized');
        expect(comparisons[0].extraPerOperationMs).toBe(6);
        expect(comparisons[0].ratio).toBe(2.5);
    });

    it('renders ranked comparison rows only when paired baselines exist', () => {
        const environment = {
            suite: 'small',
            mode: 'database',
            databaseUrl: 'postgres://postgres:****@localhost/entitykit',
        };

        const evidence = formatBenchmarkEvidence(environment, [
            result('raw pg: select by id', 1),
            result('EntityKit: DbSet.find by id', 3),
            result('raw pg: insert batch', 5),
            result('EntityKit: saveChanges insert batch', 6),
        ]);

        expect(evidence).toContain('## Raw Baseline Comparisons');
        expect(evidence).toContain('| Rank | Area | Raw pg ms/op | EntityKit ms/op | EntityKit/raw ratio | Extra ms/op |');
        expect(evidence.indexOf('| 1 | primary-key lookup | 1.0000 | 3.0000 | 3.00 | 2.0000 |'))
            .toBeLessThan(evidence.indexOf('| 2 | save insert batch | 5.0000 | 6.0000 | 1.20 | 1.0000 |'));
    });

    it('keeps compile-only evidence free of raw comparison sections', () => {
        const evidence = formatBenchmarkEvidence(
            { suite: 'small', mode: 'compile-only', databaseUrl: 'not used (compile-only)' },
            [
                result('EntityKit: query builder construction', 0.01),
                result('EntityKit: query compile toSql', 0.02),
            ],
        );

        expect(evidence).toContain('## Summary');
        expect(evidence).toContain('## Raw Results');
        expect(evidence).not.toContain('## Raw Baseline Comparisons');
    });

    it('summarizes benchmark groups with best and slowest per-operation timings', () => {
        expect(summarizeBenchmarkResults([
            result('raw pg: select by id', 1),
            result('EntityKit: query compile toSql', 0.2),
            result('EntityKit: repeated query shape compile toSql', 0.1),
        ])).toEqual([
            {
                group: 'query compilation',
                cases: 2,
                bestPerOperationMs: 0.1,
                slowestPerOperationMs: 0.2,
            },
            {
                group: 'raw pg baseline',
                cases: 1,
                bestPerOperationMs: 1,
                slowestPerOperationMs: 1,
            },
        ]);
    });
});
