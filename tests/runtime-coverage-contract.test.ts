import fs from 'node:fs';
import path from 'node:path';
import * as coverage from '../scripts/check-runtime-coverage.js';
import type {
    CoverageConfiguration,
} from '../scripts/check-runtime-coverage.js';
import { createManagedTempDirectory } from './support/managed-temp-directory';

interface CoverageMetric {
    total: number;
    covered: number;
    skipped: number;
    pct: number;
}

function metric(total: number, covered: number): CoverageMetric {
    return { total, covered, skipped: 0, pct: 0 };
}

const thresholds = {
    statements: 92,
    branches: 87,
    functions: 89,
    lines: 92,
} as const;

function coverageRecord(
    total: number,
    covered: number,
): Record<string, CoverageMetric> {
    return {
        statements: metric(total, covered),
        branches: metric(total, covered),
        functions: metric(total, covered),
        lines: metric(total, covered),
    };
}

function createCoverageProject(): {
    config: CoverageConfiguration;
    directory: string;
    runtimePath: string;
} {
    const directory = createManagedTempDirectory('entitykit-coverage-');
    const sourceDirectory = path.join(directory, 'src');
    fs.mkdirSync(path.join(sourceDirectory, 'examples'), { recursive: true });
    const runtimePath = path.join(sourceDirectory, 'runtime.ts');
    fs.writeFileSync(runtimePath, 'export const answer = 42;\n');
    fs.writeFileSync(
        path.join(sourceDirectory, 'types.ts'),
        'export interface Answer { value: number; }\n',
    );
    fs.writeFileSync(
        path.join(sourceDirectory, 'examples', 'example.ts'),
        'export const example = true;\n',
    );
    return {
        directory,
        runtimePath,
        config: {
            schemaVersion: 1,
            sourceRoot: 'src',
            excludedPathPrefixes: ['src/examples/'],
            thresholds: { ...thresholds },
        },
    };
}

describe('runtime coverage contract', () => {
    it('keeps the requested global floors in a checked-in configuration', () => {
        const config = JSON.parse(fs.readFileSync(
            path.join(process.cwd(), 'config', 'coverage.json'),
            'utf8',
        )) as { thresholds: Record<string, number> };

        expect(config.thresholds).toEqual(thresholds);
    });

    it('distinguishes executable TypeScript from erased types and barrels', () => {
        expect(coverage.hasRuntimeStatements([
            'import type { User } from \'./user\';',
            'export interface UserSet { users: User[]; }',
            'export type UserId = string;',
            'export { UserRepository } from \'./repository\';',
        ].join('\n'))).toBe(false);
        expect(coverage.hasRuntimeStatements('declare class External {}'))
            .toBe(false);
        expect(coverage.hasRuntimeStatements('export const value = 1;'))
            .toBe(true);
        expect(coverage.hasRuntimeStatements('export enum State { Ready }'))
            .toBe(true);
        expect(coverage.hasRuntimeStatements('export namespace Runtime { export const value = 1; }'))
            .toBe(true);
    });

    it('aggregates counts before calculating percentages', () => {
        const result = coverage.aggregateCoverage([
            {
                statements: metric(3, 2),
                branches: metric(2, 1),
                functions: metric(1, 1),
                lines: metric(3, 2),
            },
            {
                statements: metric(1, 1),
                branches: metric(2, 2),
                functions: metric(1, 0),
                lines: metric(1, 1),
            },
        ]);

        expect(result).toEqual({
            statements: { ...metric(4, 3), pct: 75 },
            branches: { ...metric(4, 3), pct: 75 },
            functions: { ...metric(2, 1), pct: 50 },
            lines: { ...metric(4, 3), pct: 75 },
        });
        expect(result.statements.pct).toBe(75);
        expect(result.branches.pct).toBe(75);
        expect(result.functions.pct).toBe(50);
        expect(result.lines.pct).toBe(75);
    });

    it('uses Istanbul-compatible truncation and handles empty metrics', () => {
        expect(coverage.coveragePercent(2, 3)).toBe(66.66);
        expect(coverage.coveragePercent(0, 0)).toBe(100);
    });

    it('inventories runtime, erased-type, and configured example modules', () => {
        const project = createCoverageProject();

        try {
            const inventory = coverage.runtimeSourceInventory(
                project.directory,
                project.config,
            );
            expect(inventory.included.map(file => file.relativePath))
                .toEqual(['src/runtime.ts']);
            expect(inventory.excluded.map(file => [file.relativePath, file.reason]))
                .toEqual([
                    ['src/examples/example.ts', 'configured'],
                    ['src/types.ts', 'type-only'],
                ]);
        } finally {
            fs.rmSync(project.directory, { recursive: true, force: true });
        }
    });

    it('writes machine and human reports only after enforcing all floors', () => {
        const project = createCoverageProject();
        const log = jest.spyOn(console, 'log').mockImplementation();

        try {
            const result = coverage.checkRuntimeCoverage({
                cwd: project.directory,
                config: project.config,
                jestSummary: {
                    total: coverageRecord(10, 10),
                    [project.runtimePath]: coverageRecord(10, 10),
                },
            });

            expect(result.passed).toBe(true);
            expect(log).toHaveBeenCalledWith(
                expect.stringContaining('Coverage thresholds passed.'),
            );
            expect(fs.existsSync(path.join(
                project.directory,
                'coverage',
                'runtime-summary.json',
            ))).toBe(true);
            expect(fs.readFileSync(path.join(
                project.directory,
                'coverage',
                'runtime-summary.md',
            ), 'utf8')).toContain('Status: **passed**');
        } finally {
            log.mockRestore();
            fs.rmSync(project.directory, { recursive: true, force: true });
        }
    });

    it('reports threshold failures and refuses incomplete Jest inventories', () => {
        const project = createCoverageProject();

        try {
            const inventory = coverage.runtimeSourceInventory(
                project.directory,
                project.config,
            );
            const failed = coverage.summarizeRuntimeCoverage(
                project.directory,
                {
                    total: coverageRecord(10, 8),
                    [project.runtimePath]: coverageRecord(10, 8),
                },
                inventory,
                project.config,
            );

            expect(failed.passed).toBe(false);
            expect(failed.failures).toEqual([
                { metric: 'statements', actual: 80, minimum: 92 },
                { metric: 'branches', actual: 80, minimum: 87 },
                { metric: 'functions', actual: 80, minimum: 89 },
                { metric: 'lines', actual: 80, minimum: 92 },
            ]);
            expect(() => coverage.summarizeRuntimeCoverage(
                project.directory,
                { total: coverageRecord(10, 10) },
                inventory,
                project.config,
            )).toThrow('Jest coverage is missing 1 runtime source file(s)');
        } finally {
            fs.rmSync(project.directory, { recursive: true, force: true });
        }
    });

    it('provides one command that collects and enforces runtime coverage', () => {
        const packageJson = fs.readFileSync(
            path.join(process.cwd(), 'package.json'),
            'utf8',
        );
        const jestConfig = fs.readFileSync(
            path.join(process.cwd(), 'jest.coverage.config.cjs'),
            'utf8',
        );

        expect(packageJson).toContain('"test:coverage"');
        expect(packageJson).toContain('check-runtime-coverage.js');
        expect(jestConfig).toContain('collectCoverageFrom: [\'src/**/*.ts\']');
        expect(jestConfig).toContain('coverageReporters: [\'json-summary\', \'html\', \'lcov\', \'text\']');
        expect(jestConfig).toContain('testPathIgnorePatterns: [\'/tests/integration/\']');
    });

    it('keeps mutation testing bounded to critical pure modules', () => {
        const strykerConfig = fs.readFileSync(
            path.join(process.cwd(), 'stryker.config.cjs'),
            'utf8',
        );
        const mutationJestConfig = fs.readFileSync(
            path.join(process.cwd(), 'jest.mutation.config.cjs'),
            'utf8',
        );

        expect(strykerConfig).toContain('coverageAnalysis: \'perTest\'');
        expect(strykerConfig).toContain('ignoreStatic: true');
        expect(strykerConfig).toContain('high: 95');
        expect(strykerConfig).toContain('break: 90');
        expect(strykerConfig).toContain('src/providers/mysql/mysql-value-reader.ts');
        expect(strykerConfig).toContain('src/cli/cli-rename-hints.ts');
        expect(strykerConfig).toContain('src/tracking/snapshot-value-equality.ts');
        expect(strykerConfig).toContain('src/migrations/model-diff-operation-description.ts');
        expect(strykerConfig).toContain('src/migrations/migration-column-builder.ts');
        expect(strykerConfig).toContain('src/restoration-scope.ts');
        expect(strykerConfig).toContain('src/failure-atomic-property-write.ts');
        expect(strykerConfig).toContain('src/core/created-ancestor-restoration.ts');
        expect(strykerConfig).toContain('src/core/save-plan-inspection.ts');
        expect(strykerConfig).toContain('src/core/unit-of-work/tracked-version-acceptance.ts');
        expect(strykerConfig).toContain('src/tracking/tracked-acceptance-journal.ts');
        expect(mutationJestConfig).not.toContain('tests/integration');
    });
});
