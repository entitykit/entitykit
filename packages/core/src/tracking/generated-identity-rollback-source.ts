import type { EntityConstructor } from '../types';
import type { EntityEntry } from './entity-entry';

/** Exact provider identity exposed by one generated-value hydration. */
export interface GeneratedIdentityRollbackSource {
    readonly entity: object;
    readonly entityType: EntityConstructor<object>;
    readonly keyProperties: readonly string[];
    readonly tenantKeyProperty?: string;
    readonly principal?: EntityEntry<object>;
    readonly generatedProperties: ReadonlySet<string>;
    readonly boundValues: Readonly<Record<string, unknown>>;
}
