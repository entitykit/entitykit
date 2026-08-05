import type { EntityMetadata } from '../model/entity-metadata';
import { formatIdentityValue } from '../model/identity-value';
import { toBoundPropertyValue } from '../model/value-converter/store-value';

/**
 * Key handling shared by the save plan and the many-to-many change set.
 *
 * A key value has two forms: the model form the identity map and in-memory
 * matching use, and the provider form a statement binds. Mixing them is the
 * bug this pair exists to prevent, so both live together rather than being
 * reimplemented next to each caller.
 */
export function formatSaveIdentityValue(value: unknown): string {
    return formatIdentityValue(value);
}

export /**
 * Join-table columns hold the provider form of each key column, the same form a
 * many-to-many include queries with.
 */
function toProviderKeyValues(keyValues: readonly unknown[], metadata: EntityMetadata): unknown[] {
    return metadata.keyPropertiesMetadata.map((property, index) =>
        toBoundPropertyValue(keyValues[index], property, metadata.entityName));
}
