/** Public type representing identity generation mode. */ export type IdentityGenerationMode = 'always' | 'byDefault';

/** Options that configure identity column. */ export interface IdentityColumnOptions {
    /** The mode. */ readonly mode?: IdentityGenerationMode;
    /** The start value. */ readonly startValue?: number | bigint;
    /** The increment by. */ readonly incrementBy?: number | bigint;
    /** The min value. */ readonly minValue?: number | bigint;
    /** The max value. */ readonly maxValue?: number | bigint;
    /** Whether cyclic. */ readonly isCyclic?: boolean;
    /** The cache. */ readonly cache?: number;
}

/** Options that configure row id column. */ export interface RowIdColumnOptions {
    /** Prevent reuse of previously committed rowids via SQLite AUTOINCREMENT. */
    readonly preventReuse?: boolean;
}

/** Public type representing store generation strategy. */ export type StoreGenerationStrategy =
    | {
        /** The kind. */ readonly kind: 'identity';
        /** The mode. */ readonly mode: IdentityGenerationMode;
        /** The start value. */ readonly startValue?: string;
        /** The increment by. */ readonly incrementBy?: string;
        /** The min value. */ readonly minValue?: string;
        /** The max value. */ readonly maxValue?: string;
        /** Whether cyclic. */ readonly isCyclic: boolean;
        /** The cache. */ readonly cache?: number;
    }
    | {
        /** Discriminator for database auto-increment generation. */
        readonly kind: 'autoIncrement';
    }
    | {
        /** Discriminator for SQLite rowid generation. */
        readonly kind: 'rowid';
        /** Whether SQLite must prevent reuse of committed rowids. */
        readonly preventReuse: boolean;
    }
    | {
        /** The kind. */ readonly kind: 'sequence';
        /** Stable name for this contract or database object. */ readonly name: string;
        /** The schema name. */ readonly schemaName?: string;
    };

export function identityGeneration(
    options: IdentityColumnOptions = {},
): StoreGenerationStrategy {
    const strategy = {
        kind: 'identity' as const,
        mode: options.mode ?? 'byDefault',
        startValue: integer(options.startValue, 'Identity start value'),
        incrementBy: integer(options.incrementBy, 'Identity increment'),
        minValue: integer(options.minValue, 'Identity minimum'),
        maxValue: integer(options.maxValue, 'Identity maximum'),
        isCyclic: options.isCyclic ?? false,
        cache: options.cache,
    };
    validateStoreGeneration(strategy);
    return strategy;
}

export function validateStoreGeneration(
    strategy: StoreGenerationStrategy,
): void {
    if (strategy.kind === 'identity') {
        validateIdentity(strategy);
    } else if (strategy.kind === 'sequence') {
        requireName(strategy.name, 'Sequence name');
        if (strategy.schemaName !== undefined) {
            requireName(strategy.schemaName, 'Sequence schema');
        }
    }
}

function validateIdentity(
    strategy: Extract<StoreGenerationStrategy, { /** The kind. */ kind: 'identity' }>,
): void {
    for (const [label, value] of [
        ['start value', strategy.startValue],
        ['increment', strategy.incrementBy],
        ['minimum', strategy.minValue],
        ['maximum', strategy.maxValue],
    ] as const) {
        if (value !== undefined && !/^-?\d+$/.test(value)) {
            throw new Error(`Identity ${label} must be an integer.`);
        }
    }
    if (strategy.incrementBy !== undefined && BigInt(strategy.incrementBy) === 0n) {
        throw new Error('Identity increment must not be zero.');
    }
    if (strategy.cache !== undefined &&
        (!Number.isSafeInteger(strategy.cache) || strategy.cache <= 0)) {
        throw new Error('Identity cache must be a positive safe integer.');
    }
    const minimum = toBigInt(strategy.minValue);
    const maximum = toBigInt(strategy.maxValue);
    const start = toBigInt(strategy.startValue);
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
        throw new Error('Identity minimum must not exceed its maximum.');
    }
    if (start !== undefined && minimum !== undefined && start < minimum) {
        throw new Error('Identity start value must not be below its minimum.');
    }
    if (start !== undefined && maximum !== undefined && start > maximum) {
        throw new Error('Identity start value must not exceed its maximum.');
    }
}

function integer(value: number | bigint | undefined, label: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
        throw new Error(`${label} must be a safe integer or bigint.`);
    }
    return String(value);
}

function requireName(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) {
        throw new Error(`${label} must not be empty.`);
    }
    return normalized;
}

function toBigInt(value: string | undefined): bigint | undefined {
    return value === undefined ? undefined : BigInt(value);
}
