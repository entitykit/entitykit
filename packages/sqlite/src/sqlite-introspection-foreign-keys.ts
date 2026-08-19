import type {
    DatabaseForeignKey,
    DatabasePrimaryKey,
} from '../../introspection/database-schema';
import type { DatabaseConnection } from '../../storage/database-connection';

interface ForeignKeyRow extends Record<string, unknown> {
    id: number;
    seq: number;
    table: string;
    from: string;
    to: string | null;
    on_delete: string;
}

export async function introspectSqliteForeignKeys(
    database: DatabaseConnection,
    tableName: string,
    primaryKeyByTable: ReadonlyMap<
        string,
    DatabasePrimaryKey | undefined
    >,
    reportedSchemaName: string,
): Promise<DatabaseForeignKey[]> {
    const rows = (await database.query<ForeignKeyRow>({
        text:
      'select id, seq, "table", "from", "to", on_delete from pragma_foreign_key_list(?)',
        values: [tableName],
    })).rows;

    const grouped: Map<number, ForeignKeyRow[]> = new Map();
    for (const row of rows) {
        const list = grouped.get(row.id) ?? [];
        list.push(row);
        grouped.set(row.id, list);
    }

    const foreignKeys: DatabaseForeignKey[] = [];
    for (const [id, groupRows] of grouped) {
        const ordered = [...groupRows].sort(
            (left, right) => left.seq - right.seq,
        );
        const principalTableName = ordered[0].table;
        const columns = ordered.map(row => row.from);
        const principalColumns = ordered.every(
            row => typeof row.to === 'string' && row.to.length > 0,
        )
            ? ordered
                .map(row => row.to)
                .filter((column): column is string => column !== null)
            : primaryKeyByTable.get(principalTableName)?.columns ?? [];

        foreignKeys.push({
            name: `${tableName}_${principalTableName}_${String(id)}_fkey`,
            columns,
            principalSchemaName: reportedSchemaName,
            principalTableName,
            principalColumns,
            onDelete: (ordered[0].on_delete || 'no action').toLowerCase(),
        });
    }

    return foreignKeys.sort((left, right) =>
        left.name.localeCompare(right.name),
    );
}
