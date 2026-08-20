import type { EntityKitErrorCode } from '@entitykit/core/migrations';

/** Stable error codes emitted by the versioned CLI result envelope. */
export type EntityKitCliErrorCode = 'CLI_ERROR' | 'CLI_USAGE' | EntityKitErrorCode;

/** Whether a command succeeded, found an expected difference, or failed. */
export type EntityKitCliOutcome = 'success' | 'difference' | 'error';

/** Machine-readable warning included in a CLI result. */
export interface EntityKitCliWarning {
    /** Stable warning category. */ readonly code: string;
    /** Human-readable warning. */ readonly message: string;
}

/** Machine-readable failure included in a CLI result. */
export interface EntityKitCliErrorPayload {
    /** Stable machine-readable error or provider code. */ readonly code: EntityKitCliErrorCode;
    /** Human-readable description of the failure. */ readonly message: string;
    /** Sanitized structured details, when available. */ readonly details?: Readonly<Record<string, unknown>>;
}

/** Complete result produced by a programmatic CLI invocation. */
export interface EntityKitCliResult<TData = unknown> {
    /** Version of this serialized machine contract. */ readonly schemaVersion: 1;
    /** Canonical dot-separated command name. */ readonly command: string;
    /** Semantic command outcome. */ readonly outcome: EntityKitCliOutcome;
    /** Machine-readable successful result. */ readonly data: TData | null;
    /** Structured non-fatal warnings. */ readonly warnings: readonly EntityKitCliWarning[];
    /** Machine-readable failure. */ readonly error: EntityKitCliErrorPayload | null;
    /** Process exit code. */ readonly exitCode: number;
    /** Captured human or JSON standard output. */ readonly stdout: string;
    /** Captured human standard error. */ readonly stderr: string;
}

/** Options that configure a programmatic EntityKit CLI invocation. */
export interface EntityKitCliOptions {
    /** Base directory for config discovery and relative `--cwd` values. */ readonly cwd?: string;
    /** Deterministic timestamp used by migration scaffolding. */ readonly now?: Date;
    /** Cooperative cancellation signal. */ readonly signal?: AbortSignal;
}

/** Build a successful command result. */
export function ok<TData = null>(
    stdout: string,
    data: TData | null = null,
    warnings: readonly EntityKitCliWarning[] = [],
): EntityKitCliResult<TData> {
    return result('success', 0, stdout, '', data, warnings, null);
}

/** Build a non-error result for a check that found differences. */
export function difference<TData>(stdout: string, data: TData): EntityKitCliResult<TData> {
    return result('difference', 1, stdout, '', data, [], null);
}

/** Build a failed command result. */
export function fail(
    stderr: string,
    code: EntityKitCliErrorCode = 'CLI_ERROR',
    details?: Readonly<Record<string, unknown>>,
): EntityKitCliResult {
    const exitCode = code === 'CLI_USAGE' ? 2 : code === 'OPERATION_CANCELED' ? 130 : 1;
    return result('error', exitCode, '', stderr, null, [], {
        code,
        message: stderr,
        ...details ? { details } : {},
    });
}

/** Attach command identity and serialize JSON mode exactly once. */
export function finalizeCliResult(
    commandResult: EntityKitCliResult,
    command: string,
    json: boolean,
): EntityKitCliResult {
    const structured = { ...commandResult, command };
    if (!json) {
        return structured;
    }
    const payload = {
        schemaVersion: structured.schemaVersion,
        command: structured.command,
        outcome: structured.outcome,
        data: structured.data,
        warnings: structured.warnings,
        error: structured.error,
        exitCode: structured.exitCode,
    };
    return {
        ...structured,
        stdout: JSON.stringify(payload),
        stderr: '',
    };
}

function result<TData>(
    outcome: EntityKitCliOutcome,
    exitCode: number,
    stdout: string,
    stderr: string,
    data: TData | null,
    warnings: readonly EntityKitCliWarning[],
    error: EntityKitCliErrorPayload | null,
): EntityKitCliResult<TData> {
    return {
        schemaVersion: 1,
        command: '',
        outcome,
        data,
        warnings,
        error,
        exitCode,
        stdout,
        stderr,
    };
}
