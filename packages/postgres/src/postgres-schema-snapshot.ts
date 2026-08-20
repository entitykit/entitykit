import type { DatabaseSchemaSnapshot } from '@entitykit/core/adapter';
import type {
    ColumnRow,
    ForeignKeyRow,
    PrimaryKeyRow,
} from './postgres-introspect-queries';
import type { IndexRow } from './postgres-introspect-index-query';
import type {
    CheckConstraintRow,
    SequenceRow,
} from './postgres-introspect-schema-queries';
import { normalizePostgresStringArray, renderPostgresStoreType } from './postgres-introspection-values';
import { toPostgresIndex, toPostgresSequence } from './postgres-schema-facets';
import type { MutablePostgresDatabaseTable } from './postgres-schema-snapshot-types';
import { postgresColumnGeneration } from './postgres-column-generation';

export function buildPostgresSchemaSnapshot(
    columns: readonly ColumnRow[],
    primaryKeys: readonly PrimaryKeyRow[],
    indexes: readonly IndexRow[],
    foreignKeys: readonly ForeignKeyRow[],
    checkConstraints: readonly CheckConstraintRow[] = [],
    sequences: readonly SequenceRow[] = [],
): DatabaseSchemaSnapshot {
    const schemas: Map<string, Map<string, MutablePostgresDatabaseTable>> = new Map();
    for (const sequence of sequences) {
        if (!schemas.has(sequence.schemaname)) {
            schemas.set(sequence.schemaname, new Map());
        }
    }

    for (const column of columns) {
        const storeGeneration = postgresColumnGeneration(column);
        const tables = schemas.get(column.table_schema) ??
            new Map<string, MutablePostgresDatabaseTable>();
        const table = tables.get(column.table_name) ?? {
            schemaName: column.table_schema,
            tableName: column.table_name,
            objectType: column.table_type === 'VIEW' ? 'view' : 'table',
            columns: [],
            indexes: [],
            foreignKeys: [],
            checkConstraints: [],
        };
        table.columns.push({
            name: column.column_name,
            ordinal: Number(column.ordinal_position),
            storeType: renderPostgresStoreType(column),
            isNullable: column.is_nullable === 'YES',
            defaultSql: storeGeneration
                ? undefined
                : column.column_default ?? undefined,
            isStoreGenerated: storeGeneration !== undefined,
            storeGeneration,
            collation: column.collation_name ?? undefined,
            generatedExpression: column.is_generated === 'ALWAYS'
                ? column.generation_expression ?? undefined
                : undefined,
            generatedStored: column.is_generated === 'ALWAYS' ? true : undefined,
        });
        tables.set(column.table_name, table);
        schemas.set(column.table_schema, tables);
    }

    for (const primaryKey of primaryKeys) {
        const table = schemas
            .get(primaryKey.table_schema)
            ?.get(primaryKey.table_name);
        if (table) {
            table.primaryKey = {
                name: primaryKey.constraint_name,
                columns: normalizePostgresStringArray(primaryKey.columns),
            };
        }
    }

    for (const index of indexes) {
        const table = schemas
            .get(index.table_schema)
            ?.get(index.table_name);
        if (table) {
            table.indexes.push(toPostgresIndex(index));
        }
    }

    for (const check of checkConstraints) {
        schemas.get(check.table_schema)?.get(check.table_name)?.checkConstraints.push({
            name: check.constraint_name,
            sql: check.expression,
        });
    }

    for (const foreignKey of foreignKeys) {
        const table = schemas
            .get(foreignKey.table_schema)
            ?.get(foreignKey.table_name);
        if (table) {
            table.foreignKeys.push({
                name: foreignKey.constraint_name,
                columns: normalizePostgresStringArray(foreignKey.columns),
                principalSchemaName: foreignKey.foreign_table_schema,
                principalTableName: foreignKey.foreign_table_name,
                principalColumns: normalizePostgresStringArray(
                    foreignKey.foreign_columns,
                ),
                onDelete: foreignKey.delete_rule.toLowerCase(),
            });
        }
    }

    return {
        schemas: Array.from(schemas.entries())
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, tables]) => ({
                name,
                sequences: sequences
                    .filter(sequence => sequence.schemaname === name)
                    .map(toPostgresSequence),
                tables: Array.from(tables.values())
                    .sort((left, right) =>
                        left.tableName.localeCompare(right.tableName),
                    )
                    .map(table => ({
                        schemaName: table.schemaName,
                        tableName: table.tableName,
                        objectType: table.objectType,
                        columns: table.columns.sort(
                            (left, right) => left.ordinal - right.ordinal,
                        ),
                        primaryKey: table.primaryKey,
                        indexes: table.indexes.sort((left, right) =>
                            left.name.localeCompare(right.name),
                        ),
                        foreignKeys: table.foreignKeys.sort((left, right) =>
                            left.name.localeCompare(right.name),
                        ),
                        checkConstraints: table.checkConstraints.sort((left, right) =>
                            left.name.localeCompare(right.name)),
                    })),
            })),
    };
}
