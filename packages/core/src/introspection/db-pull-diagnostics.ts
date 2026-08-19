/**
 * Collects review warnings for a db-pull result: renamed context names,
 * ambiguous join tables, out-of-snapshot or incomplete foreign
 * keys, store types needing a converter and skipped indexes. Kept apart from the
 * emitters because a diagnostic describes what a human must review, not source
 * text that gets written to a file.
 */
import type { DbPullCodegenOptions, DbPullDiagnostic, EntityShape } from './db-pull-codegen-types';
import { toPascalIdentifier } from './db-pull-naming';
import { mapStoreTypeToTypeScript } from './db-pull-type-mapping';
import { isReviewRequiredJoinEntity } from './db-pull-many-to-many-model';
import { unsupportedStoreGeneration } from './db-pull-store-generation';
import {
    describeColumn,
    describeForeignKeyTarget,
    describeTable,
    foreignKeyPropertiesFor,
    formatSkippedIndexMessage,
    tableKey,
} from './db-pull-emit-helpers';
import { findForeignKeyTargetKey } from './db-pull-relationship-helpers';

export function collectDbPullDiagnostics(
    options: DbPullCodegenOptions,
    contextName: string,
    entities: readonly EntityShape[],
    entityByTable: ReadonlyMap<string, EntityShape>,
): DbPullDiagnostic[] {
    const diagnostics: DbPullDiagnostic[] = [];
    const requestedContextName = toPascalIdentifier(options.contextName ?? 'AppDbContext');
    if (contextName !== requestedContextName) {
        diagnostics.push(dbPullWarning(
            'generated-name',
            `Requested DbContext name '${requestedContextName}' was rewritten to '${contextName}' to avoid a generated entity name collision.`,
        ));
    }

    for (const entity of entities) {
        const tableName = describeTable(entity.table);
        if (!entity.table.primaryKey && entity.table.objectType !== 'view') {
            diagnostics.push(dbPullWarning(
                'table',
                `Table ${tableName} has no primary key; generated starter configures it with hasNoKey(). Review whether the table should remain keyless.`,
            ));
        }
        if (isReviewRequiredJoinEntity(entity.table, entityByTable)) {
            diagnostics.push(dbPullWarning(
                'unsupported-schema',
                `Table ${tableName} looks like a join table with payload or ambiguous columns; generated starter keeps it as an explicit entity. Review whether it should stay explicit or be modeled manually.`,
            ));
        }

        for (const foreignKey of entity.table.foreignKeys) {
            const principal = entityByTable.get(tableKey(foreignKey.principalSchemaName, foreignKey.principalTableName));
            const foreignKeyProperties = foreignKeyPropertiesFor(entity, foreignKey);
            if (!principal) {
                diagnostics.push(dbPullWarning(
                    'relationship',
                    `Foreign key '${foreignKey.name}' on ${tableName} references ${describeForeignKeyTarget(foreignKey)} outside this db pull snapshot; relationship metadata was skipped.`,
                ));
                continue;
            }

            if (!foreignKeyProperties) {
                diagnostics.push(dbPullWarning(
                    'relationship',
                    `Foreign key '${foreignKey.name}' on ${tableName} has incomplete local column metadata; relationship metadata was skipped.`,
                ));
                continue;
            }

            if (!findForeignKeyTargetKey(foreignKey, principal)) {
                diagnostics.push(dbPullWarning(
                    'relationship',
                    `Foreign key '${foreignKey.name}' on ${tableName} targets principal columns (${foreignKey.principalColumns.join(', ')}) without a supported primary or unique key; relationship metadata was skipped.`,
                ));
            }
        }

        for (const column of entity.table.columns) {
            const unsupportedGeneration = unsupportedStoreGeneration(
                entity,
                column,
            );
            if (unsupportedGeneration) {
                diagnostics.push(dbPullWarning(
                    'unsupported-schema',
                    `Column ${describeColumn(entity.table, column)} cannot reproduce its provider generation because ${unsupportedGeneration}; generated starter keeps valueGeneratedOnAdd() for existing-schema writes but skips the unsupported DDL strategy.`,
                ));
            }
            const typeMapping = mapStoreTypeToTypeScript(column.storeType);
            if (typeMapping.needsReview) {
                diagnostics.push(dbPullWarning(
                    'column',
                    `Column ${describeColumn(entity.table, column)} uses store type '${column.storeType}'; generated TypeScript type is '${typeMapping.type}'. Add a value converter or refine the generated property type.`,
                ));
            }
        }

        for (const index of entity.table.indexes) {
            const unmappedColumns = index.columns.filter(column => !entity.propertiesByColumn.has(column));
            if (
                (index.keyParts?.length ?? index.columns.length) === 0 ||
        unmappedColumns.length > 0 ||
        index.unsupportedFeatures?.length
            ) {
                diagnostics.push(dbPullWarning(
                    'index',
                    formatSkippedIndexMessage(entity.table, index, unmappedColumns),
                ));
            }
        }
    }

    return diagnostics;
}

function dbPullWarning(category: DbPullDiagnostic['category'], message: string): DbPullDiagnostic {
    return {
        severity: 'warning',
        category,
        message,
    };
}
