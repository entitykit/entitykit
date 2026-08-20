import type {
    DatabaseColumn,
    DatabasePrimaryKey,
} from '@entitykit/core/adapter';
import type { DatabaseConnection } from '@entitykit/core/adapter';
import { parseSqliteTableSql } from './sqlite-ddl-parser';

interface TableInfoRow extends Record<string, unknown> {
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
    hidden?: number;
}

export interface SqliteColumnIntrospection {
    readonly columns: DatabaseColumn[];
    readonly primaryKey?: DatabasePrimaryKey;
}

export async function introspectSqliteColumns(
    database: DatabaseConnection,
    tableName: string,
    createSql?: string,
): Promise<SqliteColumnIntrospection> {
    const rows = (await database.query<TableInfoRow>({
        text:
      'select cid, name, type, "notnull" as "notnull", dflt_value, pk, hidden from pragma_table_xinfo(?)',
        values: [tableName],
    })).rows;

    const primaryKeyRows = rows
        .filter(row => row.pk > 0)
        .sort((left, right) => left.pk - right.pk);
    const parsed = parseSqliteTableSql(createSql);
    const primaryKeyColumn = primaryKeyRows[0];
    const rowIdColumn = !parsed.withoutRowId &&
    primaryKeyRows.length === 1 &&
    primaryKeyColumn.type.trim().toLowerCase() === 'integer' &&
    !parsed.columns.get(primaryKeyColumn.name)?.primaryKeyDescending
        ? primaryKeyColumn.name
        : undefined;
    const columns: DatabaseColumn[] = rows.map(row => {
        const ddl = parsed.columns.get(row.name);
        return {
            name: row.name,
            ordinal: row.cid,
            storeType:
      typeof row.type === 'string' && row.type.trim().length > 0
          ? row.type.toLowerCase()
          : 'text',
            isNullable: row.notnull === 0 && row.pk === 0,
            defaultSql: readDefaultSql(row.dflt_value),
            isStoreGenerated: row.name === rowIdColumn,
            storeGeneration: row.name === rowIdColumn
                ? {
                    kind: 'rowid',
                    preventReuse: ddl?.autoIncrement ?? false,
                }
                : undefined,
            collation: ddl?.collation,
            generatedExpression: ddl?.generatedExpression,
            generatedStored: ddl?.generatedExpression
                ? ddl.generatedStored ?? row.hidden === 3
                : undefined,
        };
    });

    const pkColumns = primaryKeyRows
        .map(row => row.name);

    const primaryKey = pkColumns.length > 0
        ? { name: `${tableName}_pkey`, columns: pkColumns }
        : undefined;

    return { columns, primaryKey };
}

function readDefaultSql(value: unknown): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'bigint'
    ) {
        return String(value);
    }
    throw new TypeError('SQLite returned a non-scalar column default.');
}
