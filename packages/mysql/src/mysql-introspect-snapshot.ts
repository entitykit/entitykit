import type {
    DatabaseColumn,
    DatabaseCheckConstraint,
    DatabaseForeignKey,
    DatabaseIndex,
    DatabasePrimaryKey,
    DatabaseSchemaSnapshot,
} from '../../introspection/database-schema';
import { normalizeDefault } from './mysql-introspect-defaults';
import type { CheckConstraintRow, ColumnRow, ForeignKeyRow, StatisticRow, TableRow } from './mysql-introspect-queries';
import { collectForeignKeyNames, groupForeignKeys, groupIndexes } from './mysql-introspect-relations';
const PRIMARY_INDEX_NAME = 'PRIMARY';
export function buildSnapshot(
    tableRows: readonly TableRow[],
    columns: readonly ColumnRow[],
    statistics: readonly StatisticRow[],
    foreignKeys: readonly ForeignKeyRow[],
    currentDatabase: string,
    checks: readonly CheckConstraintRow[] = [],
): DatabaseSchemaSnapshot {
    const schemaNameFor = (database: string): string => database === currentDatabase ? '' : database;
    const foreignKeyNames = collectForeignKeyNames(foreignKeys);
    const schemas: Map<string, Map<string, MutableDatabaseTable>> = new Map();

    const tableFor = (database: string, tableName: string): MutableDatabaseTable | undefined => schemas.get(database)?.get(tableName);

    for (const row of tableRows) {
        const tables = schemas.get(row.table_schema) ?? new Map<string, MutableDatabaseTable>();
        tables.set(row.table_name, {
            schemaName: schemaNameFor(row.table_schema),
            tableName: row.table_name,
            objectType: row.table_type === 'VIEW' ? 'view' : 'table',
            columns: [],
            indexes: [],
            foreignKeys: [],
            checkConstraints: [],
        });
        schemas.set(row.table_schema, tables);
    }

    for (const column of columns) {
        const table = tableFor(column.table_schema, column.table_name);
        if (!table) {
            continue; // a view column, or a table filtered out above
        }
        const autoIncrement =
            column.extra?.toLowerCase().includes('auto_increment') ?? false;
        table.columns.push({
            name: column.column_name,
            ordinal: Number(column.ordinal_position),
            storeType: column.column_type.toLowerCase(),
            isNullable: column.is_nullable === 'YES',
            defaultSql: normalizeDefault(column.column_default, column.column_type, column.extra),
            isStoreGenerated: autoIncrement,
            storeGeneration: autoIncrement
                ? { kind: 'autoIncrement' }
                : undefined,
            collation: column.collation_name ?? undefined,
            generatedExpression: nonEmpty(column.generation_expression),
            generatedStored: column.generation_expression?.trim()
                ? column.extra?.toLowerCase().includes('stored') ?? false
                : undefined,
        });
    }

    const indexGroups = groupIndexes(statistics);
    for (const group of indexGroups) {
        const table = tableFor(group.database, group.tableName);
        if (!table) {
            continue;
        }

        if (group.indexName === PRIMARY_INDEX_NAME) {
            table.primaryKey = { name: `${group.tableName}_pkey`, columns: group.columns };
            continue;
        }

        if (foreignKeyNames.get(group.database)?.get(group.tableName)?.has(group.indexName)) {
            continue;
        }

        table.indexes.push({
            name: group.indexName,
            columns: group.columns,
            keyParts: group.keyParts,
            isUnique: group.isUnique,
            unsupportedFeatures: group.unsupportedFeatures,
        });
    }

    for (const check of checks) {
        tableFor(check.constraint_schema, check.table_name)?.checkConstraints.push({
            name: check.constraint_name,
            sql: check.check_clause,
        });
    }

    const foreignKeyGroups = groupForeignKeys(foreignKeys);
    for (const group of foreignKeyGroups) {
        const table = tableFor(group.database, group.tableName);
        if (table) {
            table.foreignKeys.push({
                name: group.constraintName,
                columns: group.columns,
                principalSchemaName: schemaNameFor(group.referencedDatabase),
                principalTableName: group.referencedTable,
                principalColumns: group.referencedColumns,
                onDelete: group.deleteRule.toLowerCase(),
            });
        }
    }

    return {
        schemas: Array.from(schemas.entries())
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([database, tables]) => ({
                name: schemaNameFor(database),
                tables: Array.from(tables.values())
                    .sort((left, right) => left.tableName.localeCompare(right.tableName))
                    .map(table => ({
                        schemaName: table.schemaName,
                        tableName: table.tableName,
                        objectType: table.objectType,
                        columns: table.columns.sort((left, right) => left.ordinal - right.ordinal),
                        primaryKey: table.primaryKey,
                        indexes: table.indexes.sort((left, right) => left.name.localeCompare(right.name)),
                        foreignKeys: table.foreignKeys.sort((left, right) => left.name.localeCompare(right.name)),
                        checkConstraints: table.checkConstraints.sort((left, right) => left.name.localeCompare(right.name)),
                    })),
            })),
    };
}
interface MutableDatabaseTable {
    schemaName: string;
    tableName: string;
    objectType: 'table' | 'view';
    columns: DatabaseColumn[];
    primaryKey?: DatabasePrimaryKey;
    indexes: DatabaseIndex[];
    foreignKeys: DatabaseForeignKey[];
    checkConstraints: DatabaseCheckConstraint[];
}
function nonEmpty(value: string | null | undefined): string | undefined {
    const normalized = value?.trim();
    if (!normalized) {
        return undefined;
    }
    return normalized;
}
