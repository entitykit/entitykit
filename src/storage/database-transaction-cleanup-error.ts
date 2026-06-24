import {
    DatabaseProviderError,
    type DatabaseProviderOperation,
} from './database-provider-error';
import type { DebugSqlOptions } from '../sql/debug-sql';

/** Typed error reported for database transaction cleanup failures. */ export class DatabaseTransactionCleanupError extends Error {
    /** Original failure, when one is available. */ public override readonly cause: unknown;
    /** Name of the configured database provider. */ public readonly provider: string;
    /** The operation. */ public readonly operation: DatabaseProviderOperation;
    /** The primary error. */ public readonly primaryError: unknown;
    /** The cleanup error. */ public readonly cleanupError: DatabaseProviderError;

    constructor(provider: string, primaryError: unknown, cleanupError: DatabaseProviderError) {
        super(`${capitalizeProvider(provider)} ${cleanupError.operation} failed while cleaning up a transaction failure.`);
        this.name = 'DatabaseTransactionCleanupError';
        this.cause = cleanupError;
        this.provider = provider;
        this.operation = cleanupError.operation;
        this.primaryError = primaryError;
        this.cleanupError = cleanupError;
    }

    /** Return a JSON-safe representation. */ public toJSON(options: DebugSqlOptions = {}): Record<string, unknown> {
        return {
            name: this.name,
            message: this.message,
            provider: this.provider,
            operation: this.operation,
            primaryError: serializeError(this.primaryError, options),
            cleanupError: this.cleanupError.toJSON(options),
        };
    }
}

function capitalizeProvider(provider: string): string {
    return provider.length === 0
        ? 'Provider'
        : `${provider.charAt(0).toUpperCase()}${provider.slice(1)}`;
}

function serializeError(error: unknown, options: DebugSqlOptions): unknown {
    if (error instanceof DatabaseProviderError || error instanceof DatabaseTransactionCleanupError) {
        return error.toJSON(options);
    }
    if (error instanceof Error) {
        return { name: error.name, message: error.message };
    }
    return error;
}
