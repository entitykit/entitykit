import type { ModificationSqlBuilder } from '../../sql/modification-sql-builder';
import { validateRequiredComplexPropertyValues } from '../../sql/required-complex-property-validation';
import { modifiedEntityValueProperties } from '../../tracking/entity-entry-snapshot';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { EntityState } from '../../tracking/entity-state';
import type { SqlStatement } from '../../sql/sql-statement';
import { assertNoKeyModifications } from './immutable-key-change';
import { assertNoVersionModifications } from './store-managed-version-change';

export function buildSaveStatement(
    sql: ModificationSqlBuilder,
    snapshot: PersistedEntrySnapshot,
): SqlStatement | undefined {
    const { entry } = snapshot;
    if (snapshot.state === EntityState.Added) {
        validateRequiredComplexPropertyValues(
            entry.metadata, snapshot.complexPropertyValues,
        );
        return sql.buildInsertFromValues(
            entry.metadata,
            snapshot.values,
            [],
            snapshot.boundValues,
        );
    }
    if (snapshot.state === EntityState.Modified) {
        validateRequiredComplexPropertyValues(
            entry.metadata, snapshot.complexPropertyValues,
        );
        const detectedProperties = modifiedEntityValueProperties(
            entry.metadata, snapshot.values, entry.originalValues,
        );
        const modifiedProperties = entry.metadata.softDelete
            ? includeSoftDeleteTransition(
                entry.metadata.softDelete.propertyName,
                snapshot.values,
                entry.originalValues,
                detectedProperties,
            )
            : detectedProperties;
        assertNoKeyModifications(entry, modifiedProperties);
        assertNoVersionModifications(entry, modifiedProperties);
        return sql.buildUpdateFromValues(
            entry.metadata,
            snapshot.values,
            modifiedProperties,
            entry.originalValues,
            snapshot.boundValues,
            snapshot.originalBoundValues,
        );
    }
    if (snapshot.state === EntityState.Deleted) {
        const modifiedProperties = modifiedEntityValueProperties(
            entry.metadata, snapshot.values, entry.originalValues,
        );
        assertNoKeyModifications(entry, modifiedProperties);
        return sql.buildDeleteFromValues(
            entry.metadata,
            entry.originalValues,
            entry.originalValues,
            snapshot.originalBoundValues,
            snapshot.originalBoundValues,
        );
    }
    return undefined;
}

function includeSoftDeleteTransition(
    property: string,
    values: Readonly<Record<string, unknown>>,
    originalValues: Readonly<Record<string, unknown>>,
    modifiedProperties: string[],
): string[] {
    if (
        modifiedProperties.includes(property) ||
        values[property] === null ||
        values[property] === undefined ||
        originalValues[property] !== null && originalValues[property] !== undefined
    ) {
        return modifiedProperties;
    }
    return [...modifiedProperties, property];
}
