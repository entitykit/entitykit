import {
    EntityKitError,
    type EntityKitErrorCode,
} from './entity-kit-error';

/** Options that configure db update error. */ export interface DbUpdateErrorOptions {
    /** Stable machine-readable error or provider code. */ readonly code?: Extract<EntityKitErrorCode, `DB_${string}`>;
    /** Structured details for diagnostics and machine inspection. */ readonly details?: Readonly<Record<string, unknown>>;
    /** Original failure, when one is available. */ readonly cause?: unknown;
}

/** Typed error reported for db update failures. */ export class DbUpdateError extends EntityKitError {
    constructor(message: string, options: DbUpdateErrorOptions = {}) {
        super(message, {
            code: options.code ?? 'DB_UPDATE_ERROR',
            details: options.details,
            cause: options.cause,
        });
    }
}

/** Typed error reported for unique constraint failures. */ export class UniqueConstraintError extends DbUpdateError {
    constructor(constraint?: string, cause?: unknown) {
        super(`Unique constraint violation${constraint ? ` on '${constraint}'` : ''}.`, {
            code: 'DB_UNIQUE_CONSTRAINT',
            details: { constraint },
            cause,
        });
        this.name = 'UniqueConstraintError';
    }
}

/** Typed error reported for foreign key constraint failures. */ export class ForeignKeyConstraintError extends DbUpdateError {
    constructor(constraint?: string, cause?: unknown) {
        super(`Foreign key constraint violation${constraint ? ` on '${constraint}'` : ''}.`, {
            code: 'DB_FOREIGN_KEY_CONSTRAINT',
            details: { constraint },
            cause,
        });
        this.name = 'ForeignKeyConstraintError';
    }
}

/** Typed error reported for not null constraint failures. */ export class NotNullConstraintError extends DbUpdateError {
    constructor(column?: string, cause?: unknown) {
        super(`Required database column was null${column ? `: '${column}'` : ''}.`, {
            code: 'DB_NOT_NULL_CONSTRAINT',
            details: { column },
            cause,
        });
        this.name = 'NotNullConstraintError';
    }
}

/** Perform the map database provider error operation. */ export function mapDatabaseProviderError(error: unknown): unknown {
    if (!error || typeof error !== 'object') {
        return error;
    }

    const record = error as { readonly name?: unknown; /** Stable machine-readable error or provider code. */ readonly code?: unknown; readonly constraint?: unknown; readonly column?: unknown };
    if (record.name !== 'DatabaseProviderError') {
        return error;
    }

    const constraint = typeof record.constraint === 'string' ? record.constraint : undefined;
    const column = typeof record.column === 'string' ? record.column : undefined;

    switch (record.code) {
    // Postgres SQLSTATE.
        // SQLite extended result codes and MySQL error names cannot collide
        // with Postgres SQLSTATE values, so one table classifies all providers.
        case '23505':
        case '1555':
        case '2067':
        case 'ER_DUP_ENTRY':
            return new UniqueConstraintError(constraint, error);
        case '23503':
        case '787':
        case 'ER_NO_REFERENCED_ROW_2':
        case 'ER_ROW_IS_REFERENCED_2':
            return new ForeignKeyConstraintError(constraint, error);
        case '23502':
        case '1299':
        case 'ER_BAD_NULL_ERROR':
            return new NotNullConstraintError(column, error);
        default:
            return error;
    }
}
