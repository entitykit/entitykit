import type { ModificationSqlBuilder } from '../../sql/modification-sql-builder';
import { validateRequiredComplexPropertyValues } from '../../sql/required-complex-property-validation';
import { modifiedEntityValueProperties } from '../../tracking/entity-entry-snapshot';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { EntityState } from '../../tracking/entity-state';
import type { SqlStatement } from '../../sql/sql-statement';
import { assertNoKeyModifications } from './immutable-key-change';

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
        const modifiedProperties = modifiedEntityValueProperties(
            entry.metadata, snapshot.values, entry.originalValues,
        );
        assertNoKeyModifications(entry, modifiedProperties);
        return sql.buildUpdateFromValues(
            entry.metadata,
            snapshot.values,
            modifiedProperties,
            entry.originalValues,
        );
    }
    if (snapshot.state === EntityState.Deleted) {
        return sql.buildDeleteFromValues(
            entry.metadata, snapshot.values, entry.originalValues,
        );
    }
    return undefined;
}
