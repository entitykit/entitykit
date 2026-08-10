import type { ModificationSqlBuilder } from '../../sql/modification-sql-builder';
import { validateRequiredComplexPropertyValues } from '../../sql/required-complex-property-validation';
import { modifiedEntityValueProperties } from '../../tracking/entity-entry-snapshot';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { EntityState } from '../../tracking/entity-state';
import type { SqlStatement } from '../../sql/sql-statement';
import { assertNoKeyModifications } from './immutable-key-change';
import { assertNoVersionModifications } from './store-managed-version-change';
import type { EntityMetadata } from '../../model/entity-metadata';

export function buildSaveStatement(
    sql: ModificationSqlBuilder,
    snapshot: PersistedEntrySnapshot,
): SqlStatement | undefined {
    const { entry } = snapshot;
    if (snapshot.state === EntityState.Added) {
        validateRequiredComplexPropertyValues(
            entry.metadata, snapshot.complexPropertyValues,
        );
        return sql.buildInsertFromValues(entry.metadata, snapshot.values);
    }
    if (snapshot.state === EntityState.Modified) {
        validateRequiredComplexPropertyValues(
            entry.metadata, snapshot.complexPropertyValues,
        );
        const modifiedProperties = includeSoftDeleteTransition(
            entry.metadata,
            snapshot.values,
            entry.originalValues,
            modifiedEntityValueProperties(
                entry.metadata, snapshot.values, entry.originalValues,
            ),
        );
        assertNoKeyModifications(entry, modifiedProperties);
        assertNoVersionModifications(entry, modifiedProperties);
        return sql.buildUpdateFromValues(
            entry.metadata,
            snapshot.values,
            modifiedProperties,
            entry.originalValues,
        );
    }
    if (snapshot.state === EntityState.Deleted) {
        const modifiedProperties = modifiedEntityValueProperties(
            entry.metadata, snapshot.values, entry.originalValues,
        );
        assertNoKeyModifications(entry, modifiedProperties);
        return sql.buildDeleteFromValues(
            entry.metadata, entry.originalValues, entry.originalValues,
        );
    }
    return undefined;
}

function includeSoftDeleteTransition<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    values: Readonly<Record<string, unknown>>,
    originalValues: Readonly<Record<string, unknown>>,
    modifiedProperties: string[],
): string[] {
    const property = metadata.softDelete?.propertyName;
    if (
        !property ||
        modifiedProperties.includes(property) ||
        values[property] === null ||
        values[property] === undefined ||
        originalValues[property] !== null && originalValues[property] !== undefined
    ) {
        return modifiedProperties;
    }
    return [...modifiedProperties, property];
}
