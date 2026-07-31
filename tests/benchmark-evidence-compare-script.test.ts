import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createManagedTempDirectory } from './support/managed-temp-directory';

const loadModule = createRequire(__filename);

const scriptPath = path.join(process.cwd(), 'scripts/compare-benchmark-evidence.js');

interface BenchmarkEvidenceCompareScript {
    compareBenchmarkEvidence: (
        before: ParsedEvidence,
        after: ParsedEvidence,
    ) => {
        matched: Array<{ name: string; deltaPerOperationMs: number; percentChange: number }>;
        missingInAfter: string[];
        missingInBefore: string[];
    };
    formatBenchmarkEvidenceComparison: (before: ParsedEvidence, after: ParsedEvidence) => string;
    parseBenchmarkEvidence: (markdown: string, filePath?: string) => ParsedEvidence;
}

interface ParsedEvidence {
    filePath: string;
    environment: Record<string, string>;
    results: Array<{ name: string; perOperationMs: number }>;
}

const script = loadModule(scriptPath) as BenchmarkEvidenceCompareScript;

function evidence(commit: string, rows: string[]): string {
    return [
        '# Benchmark Evidence: small',
        '',
        '## Environment',
        '',
        '| Field | Value |',
        '| --- | --- |',
        '| suite | small |',
        `| gitCommit | ${commit} |`,
        '',
        '## Raw Results',
        '',
        '| Case | Iterations | Total ms | Per operation ms | Operations/sec |',
        '| --- | ---: | ---: | ---: | ---: |',
        ...rows,
        '',
    ].join('\n');
}

describe('benchmark evidence comparison script', () => {
    it('parses evidence and ranks matched cases by largest absolute delta', () => {
        const before = script.parseBenchmarkEvidence(evidence('before123', [
            '| EntityKit: saveChanges update | 100 | 200.00 | 2.0000 | 500 |',
            '| EntityKit: query compile toSql | 100 | 1.00 | 0.0100 | 100000 |',
            '| before only | 100 | 30.00 | 0.3000 | 3333 |',
        ]), 'before.md');
        const after = script.parseBenchmarkEvidence(evidence('after456', [
            '| EntityKit: saveChanges update | 100 | 150.00 | 1.5000 | 667 |',
            '| EntityKit: query compile toSql | 100 | 2.00 | 0.0200 | 50000 |',
            '| after only | 100 | 40.00 | 0.4000 | 2500 |',
        ]), 'after.md');

        const comparison = script.compareBenchmarkEvidence(before, after);

        expect(before.environment.gitCommit).toBe('before123');
        expect(comparison.matched.map(item => item.name)).toEqual([
            'EntityKit: saveChanges update',
            'EntityKit: query compile toSql',
        ]);
        expect(comparison.matched[0].deltaPerOperationMs).toBeCloseTo(-0.5);
        expect(comparison.missingInAfter).toEqual(['before only']);
        expect(comparison.missingInBefore).toEqual(['after only']);
    });

    it('formats a Markdown comparison with input metadata and unmatched cases', () => {
        const before = script.parseBenchmarkEvidence(evidence('before123', [
            '| EntityKit: saveChanges update | 100 | 200.00 | 2.0000 | 500 |',
        ]), 'docs/benchmarks/before.md');
        const after = script.parseBenchmarkEvidence(evidence('after456', [
            '| EntityKit: saveChanges update | 100 | 150.00 | 1.5000 | 667 |',
            '| EntityKit: saveChanges attached update | 100 | 100.00 | 1.0000 | 1000 |',
        ]), 'docs/benchmarks/after.md');

        const markdown = script.formatBenchmarkEvidenceComparison(before, after);

        expect(markdown).toContain('# Benchmark Evidence Comparison');
        expect(markdown).toContain('Before: `docs/benchmarks/before.md` (suite small, commit before123)');
        expect(markdown).toContain('| EntityKit: saveChanges update | 2.0000 | 1.5000 | -0.5000 | -25.0% |');
        expect(markdown).toContain('- New after: `EntityKit: saveChanges attached update`');
    });

    it('runs from the CLI with two evidence paths', () => {
        const dir = createManagedTempDirectory('entitykit-benchmark-compare-');
        const beforePath = path.join(dir, 'before.md');
        const afterPath = path.join(dir, 'after.md');
        writeFileSync(beforePath, evidence('before123', [
            '| EntityKit: saveChanges update | 100 | 200.00 | 2.0000 | 500 |',
        ]), 'utf8');
        writeFileSync(afterPath, evidence('after456', [
            '| EntityKit: saveChanges update | 100 | 150.00 | 1.5000 | 667 |',
        ]), 'utf8');

        const result = spawnSync(process.execPath, [scriptPath, beforePath, afterPath], {
            encoding: 'utf8',
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('# Benchmark Evidence Comparison');
        expect(result.stdout).toContain('| EntityKit: saveChanges update | 2.0000 | 1.5000 | -0.5000 | -25.0% |');
        expect(readFileSync(beforePath, 'utf8')).toContain('before123');
    });
});
