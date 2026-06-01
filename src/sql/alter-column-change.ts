import type { StoreGenerationStrategy } from '../model/store-generation';

/**
 * A resolved column change for `alterColumn`. The per-field `*Changed` flags
 * drive Postgres's independent sub-statements; the `resolved*` values give a
 * provider that must restate the whole column (MySQL's `modify column`) its
 * effective type, nullability, and default even when only one changed —
 * MySQL's `modify` drops any default and nullability it does not restate.
 */
export interface AlterColumnChange {
    /** The type changed. */ readonly typeChanged: boolean;
    /** The nullability changed. */ readonly nullabilityChanged: boolean;
    /** The default changed. */ readonly defaultChanged: boolean;
    /** The computed changed. */ readonly computedChanged: boolean;
    /** The collation changed. */ readonly collationChanged: boolean;
    /** The store generation changed. */ readonly storeGenerationChanged: boolean;
    /** The resolved type. */ readonly resolvedType: string;
    /** The resolved not null. */ readonly resolvedNotNull: boolean;
    /** The resolved default sql. */ readonly resolvedDefaultSql?: string;
    /** The resolved computed sql. */ readonly resolvedComputedSql?: string;
    /** The resolved computed stored. */ readonly resolvedComputedStored?: boolean;
    /** The resolved collation. */ readonly resolvedCollation?: string;
    /** The resolved store generation. */ readonly resolvedStoreGeneration?: StoreGenerationStrategy;
}
