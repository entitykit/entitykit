import type { SqlStatement } from '../sql/sql-statement';
import { formatDebugSqlValues, type DebugSqlOptions } from '../sql/debug-sql';

/** Migration operation describing database provider. */ export type DatabaseProviderOperation = 'connect' | 'query' | 'stream' | 'begin' | 'commit' | 'rollback' | 'savepoint' | 'releaseSavepoint' | 'rollbackToSavepoint' | 'dispose';

/** Public contract for database provider error details. */ export interface DatabaseProviderErrorDetails {
    /** Name of the configured database provider. */ readonly provider: string;
    /** The operation. */ readonly operation: DatabaseProviderOperation;
    /** Parameterized SQL statement associated with this operation. */ readonly statement?: SqlStatement;
    /** Stable machine-readable error or provider code. */ readonly code?: string;
    /** The constraint. */ readonly constraint?: string;
    /** The table. */ readonly table?: string;
    /** The column. */ readonly column?: string;
    /** The detail. */ readonly detail?: string;
}

/** Typed error reported for database provider failures. */ export class DatabaseProviderError extends Error {
    /** Original failure, when one is available. */ public override readonly cause: unknown;
    /** Name of the configured database provider. */ public readonly provider: string;
    /** The operation. */ public readonly operation: DatabaseProviderOperation;
    /** Parameterized SQL statement associated with this operation. */ public readonly statement?: SqlStatement;
    /** Stable machine-readable error or provider code. */ public readonly code?: string;
    /** The constraint. */ public readonly constraint?: string;
    /** The table. */ public readonly table?: string;
    /** The column. */ public readonly column?: string;
    /** The detail. */ public readonly detail?: string;

    constructor(message: string, cause: unknown, details: DatabaseProviderErrorDetails) {
        super(message);
        this.name = 'DatabaseProviderError';
        this.cause = cause;
        this.provider = details.provider;
        this.operation = details.operation;
        this.statement = details.statement
            ? { text: details.statement.text, values: [...details.statement.values] }
            : undefined;
        this.code = details.code;
        this.constraint = details.constraint;
        this.table = details.table;
        this.column = details.column;
        this.detail = details.detail;
    }

    /** Return a JSON-safe representation. */ public toJSON(options: DebugSqlOptions = {}): Record<string, unknown> {
        return {
            name: this.name,
            message: this.message,
            provider: this.provider,
            operation: this.operation,
            code: this.code,
            constraint: this.constraint,
            table: this.table,
            column: this.column,
            detail: this.detail,
            statement: this.statement
                ? {
                    text: this.statement.text,
                    values: formatDebugSqlValues(this.statement.values, options),
                }
                : undefined,
        };
    }
}
