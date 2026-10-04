import { sanitizeErrorDetails } from './error-detail-sanitizer';

/** Public type representing entity kit error code. */ export type EntityKitErrorCode =
    | 'MODEL_VALIDATION'
    | 'QUERY_COMPILATION'
    | 'ENTITY_NOT_FOUND'
    | 'ENTITY_NOT_TRACKED'
    | 'MULTIPLE_ENTITIES_FOUND'
    | 'CONTEXT_NOT_INITIALIZED'
    | 'CONTEXT_DISPOSED'
    | 'CONTEXT_CONCURRENT_OPERATION'
    | 'CONTEXT_STATE_RESTORATION_FAILED'
    | 'OPERATION_CANCELED'
    | 'FOREIGN_ENTITY_ENTRY'
    | 'NAVIGATION_LOAD_UNAVAILABLE'
    | 'PROVIDER_CAPABILITY_UNSUPPORTED'
    | 'TENANT_SCOPE_UNAVAILABLE'
    | 'TENANT_OWNERSHIP_VIOLATION'
    | 'TENANT_IDENTITY_AMBIGUOUS'
    | 'DB_VALIDATION'
    | 'DB_UPDATE_ERROR'
    | 'DB_CONCURRENCY_CONFLICT'
    | 'DB_UNIQUE_CONSTRAINT'
    | 'DB_FOREIGN_KEY_CONSTRAINT'
    | 'DB_NOT_NULL_CONSTRAINT'
    | 'MIGRATION_ERROR'
    | 'MIGRATION_CHECKSUM_MISMATCH'
    | 'MIGRATION_DATA_LOSS'
    | 'MIGRATION_EXECUTION'
    | 'MIGRATION_LOCK_RELEASE'
    | 'MIGRATION_PENDING_MODEL_CHANGES';

/** Options that configure entity kit error. */ export interface EntityKitErrorOptions {
    /** Stable machine-readable error or provider code. */ readonly code: EntityKitErrorCode;
    /** Original failure, when one is available. */ readonly cause?: unknown;
    /** Structured details for diagnostics and machine inspection. */ readonly details?: Readonly<Record<string, unknown>>;
}

/** Public contract for entity kit error json. */ export interface EntityKitErrorJson {
    /** Version of this serialized machine contract. */ readonly schemaVersion: 1;
    /** Stable name for this contract or database object. */ readonly name: string;
    /** Stable machine-readable error or provider code. */ readonly code: EntityKitErrorCode;
    /** Human-readable description of the result or failure. */ readonly message: string;
    /** Structured details for diagnostics and machine inspection. */ readonly details?: Readonly<Record<string, unknown>>;
}

/** Typed error reported for entity kit failures. */ export class EntityKitError extends Error {
    /** Stable machine-readable error or provider code. */ public readonly code: EntityKitErrorCode;
    /** Structured details for diagnostics and machine inspection. */ public readonly details?: Readonly<Record<string, unknown>>;
    /** Original failure, when one is available. */ public override readonly cause?: unknown;

    constructor(message: string, options: EntityKitErrorOptions) {
        super(message);
        this.name = new.target.name;
        this.code = options.code;
        this.cause = options.cause;
        this.details = options.details;
    }

    /** Return a JSON-safe representation. */ public toJSON(): EntityKitErrorJson {
        return {
            schemaVersion: 1,
            name: this.name,
            code: this.code,
            message: this.message,
            details: this.details
                ? sanitizeErrorDetails(this.details)
                : undefined,
        };
    }
}

/** Identify EntityKit errors without relying only on one package realm. */
export function isEntityKitError(error: unknown): error is EntityKitError {
    if (!error || typeof error !== 'object') {
        return false;
    }
    try {
        const candidate = error as Partial<EntityKitError>;
        return typeof candidate.name === 'string' &&
            typeof candidate.message === 'string' &&
            typeof candidate.code === 'string' &&
            entityKitErrorCodes.has(candidate.code) &&
            typeof candidate.toJSON === 'function';
    } catch {
        return false;
    }
}

const entityKitErrorCodes: ReadonlySet<string> = new Set<EntityKitErrorCode>([
    'MODEL_VALIDATION', 'QUERY_COMPILATION', 'ENTITY_NOT_FOUND',
    'ENTITY_NOT_TRACKED',
    'MULTIPLE_ENTITIES_FOUND', 'CONTEXT_NOT_INITIALIZED', 'CONTEXT_DISPOSED',
    'CONTEXT_CONCURRENT_OPERATION', 'CONTEXT_STATE_RESTORATION_FAILED',
    'OPERATION_CANCELED',
    'FOREIGN_ENTITY_ENTRY', 'NAVIGATION_LOAD_UNAVAILABLE',
    'PROVIDER_CAPABILITY_UNSUPPORTED', 'TENANT_SCOPE_UNAVAILABLE',
    'TENANT_OWNERSHIP_VIOLATION',
    'TENANT_IDENTITY_AMBIGUOUS',
    'DB_VALIDATION', 'DB_UPDATE_ERROR', 'DB_CONCURRENCY_CONFLICT',
    'DB_UNIQUE_CONSTRAINT', 'DB_FOREIGN_KEY_CONSTRAINT',
    'DB_NOT_NULL_CONSTRAINT', 'MIGRATION_ERROR', 'MIGRATION_CHECKSUM_MISMATCH',
    'MIGRATION_DATA_LOSS', 'MIGRATION_EXECUTION', 'MIGRATION_LOCK_RELEASE',
    'MIGRATION_PENDING_MODEL_CHANGES',
]);

/** Typed error reported for db validation failures. */ export class DbValidationError extends EntityKitError {
    constructor(message: string, details?: Readonly<Record<string, unknown>>) {
        super(message, { code: 'DB_VALIDATION', details });
    }
}
