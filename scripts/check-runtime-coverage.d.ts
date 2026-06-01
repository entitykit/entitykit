export interface CoverageMetric {
    total: number;
    covered: number;
    skipped: number;
    pct: number;
}

export interface CoverageConfiguration {
    schemaVersion: 1;
    sourceRoot: string;
    excludedPathPrefixes: string[];
    thresholds: Record<'statements' | 'branches' | 'functions' | 'lines', number>;
}

export interface CoverageInventory {
    included: Array<{ absolutePath: string; relativePath: string }>;
    excluded: Array<{
        absolutePath: string;
        relativePath: string;
        reason: 'configured' | 'type-only';
    }>;
}

export interface RuntimeCoverageResult {
    schemaVersion: 1;
    scope: {
        sourceRoot: string;
        runtimeFiles: number;
        excludedFiles: number;
        excludedByReason: Record<string, number>;
    };
    thresholds: CoverageConfiguration['thresholds'];
    totals: Record<string, CoverageMetric>;
    passed: boolean;
    failures: Array<{ metric: string; actual: number; minimum: number }>;
}

export function aggregateCoverage(
    records: Array<Record<string, CoverageMetric>>,
): Record<string, CoverageMetric>;
export function checkRuntimeCoverage(options?: {
    cwd?: string;
    config?: CoverageConfiguration;
    jestSummary?: Record<string, Record<string, CoverageMetric>>;
}): RuntimeCoverageResult;
export function coveragePercent(covered: number, total: number): number;
export function hasRuntimeStatements(source: string, fileName?: string): boolean;
export function runtimeSourceInventory(
    cwd: string,
    config: CoverageConfiguration,
): CoverageInventory;
export function summarizeRuntimeCoverage(
    cwd: string,
    jestSummary: Record<string, Record<string, CoverageMetric>>,
    inventory: CoverageInventory,
    config: CoverageConfiguration,
): RuntimeCoverageResult;
