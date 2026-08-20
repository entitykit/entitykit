import type { DatabaseIndex } from '@entitykit/core/adapter';
import type { DatabaseConnection } from '@entitykit/core/adapter';
import { parseSqliteIndexSql } from './sqlite-ddl-parser';

interface IndexListRow extends Record<string, unknown> {
    name: string;
    unique: number;
    origin: string;
    partial: number;
}

interface IndexInfoRow extends Record<string, unknown> {
    seqno: number;
    name: string | null;
}

export async function introspectSqliteIndexes(
    database: DatabaseConnection,
    tableName: string,
): Promise<DatabaseIndex[]> {
    const indexRows = (await database.query<IndexListRow>({
        text:
      'select name, "unique" as "unique", origin, partial from pragma_index_list(?)',
        values: [tableName],
    })).rows;

    const indexes: DatabaseIndex[] = [];
    const names = new Set(indexRows
        .filter(row => row.origin !== 'u')
        .map(row => row.name));
    for (const indexRow of indexRows) {
        if (indexRow.origin === 'pk') {
            continue;
        }

        const indexInfo = (await database.query<IndexInfoRow>({
            text: 'select seqno, name from pragma_index_info(?)',
            values: [indexRow.name],
        })).rows;
        const columns = indexInfo
            .sort((left, right) => left.seqno - right.seqno)
            .map(row => row.name)
            .filter((name): name is string => typeof name === 'string');
        const sql = (await database.query<{ sql: string | null }>({
            text: 'select sql from sqlite_master where type = \'index\' and name = ?',
            values: [indexRow.name],
        })).rows[0]?.sql ?? undefined;
        const parsed = parseSqliteIndexSql(sql);
        const unsupportedFeatures = [
            indexInfo.some(row => row.name === null) && !parsed.keyParts
                ? 'expression'
                : undefined,
            indexRow.partial === 1 && !parsed.filter
                ? 'partial predicate'
                : undefined,
        ].filter((feature): feature is string => feature !== undefined);

        const name = indexRow.origin === 'u'
            ? automaticUniqueIndexName(tableName, columns, names)
            : indexRow.name;
        names.add(name);
        indexes.push({
            name,
            columns,
            keyParts: parsed.keyParts ?? columns.map(column => ({
                kind: 'column' as const,
                name: column,
            })),
            filter: parsed.filter,
            isUnique: indexRow.unique === 1,
            unsupportedFeatures:
        unsupportedFeatures.length > 0 ? unsupportedFeatures : undefined,
        });
    }

    return indexes.sort((left, right) =>
        left.name.localeCompare(right.name),
    );
}

function automaticUniqueIndexName(
    tableName: string,
    columns: readonly string[],
    used: ReadonlySet<string>,
): string {
    const base = `ux_${tableName}_${columns.join('_')}`;
    let name = base;
    let suffix = 2;
    while (used.has(name)) {
        name = `${base}_${String(suffix++)}`;
    }
    return name;
}
