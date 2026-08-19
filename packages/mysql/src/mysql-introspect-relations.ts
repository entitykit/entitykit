import type { ForeignKeyRow, StatisticRow } from './mysql-introspect-queries';
import { mysqlIndexUnsupportedFeatures } from './mysql-index-features';

/**
 * Fold the per-column index and foreign-key rows into per-constraint groups.
 *
 * `information_schema` returns one row per column of each (possibly composite)
 * index or foreign key; these helpers regroup those rows by constraint and
 * order the columns by their sequence. The map keys join the identifier parts
 * with a NUL (`\0`) separator so parts that are individually safe cannot
 * collide when concatenated (e.g. `a\0b` never equals `a\0` + `b`).
 */

export interface IndexGroup {
    database: string;
    tableName: string;
    indexName: string;
    isUnique: boolean;
    columns: string[];
    keyParts: Array<
        { kind: 'column'; name: string } |
        { kind: 'expression'; expression: string }
    >;
    indexType?: string;
    unsupportedFeatures?: string[];
}

export function groupIndexes(statistics: readonly StatisticRow[]): IndexGroup[] {
    const groups: Map<string, IndexGroup & {
        entries: Array<{
            seq: number;
            column: string | null;
            expression: string | null;
            subPart: number | string | null;
            collation: 'A' | 'D' | null;
        }>;
    }> = new Map();
    for (const row of statistics) {
        const key = `${row.table_schema}\0${row.table_name}\0${row.index_name}`;
        const group = groups.get(key) ?? {
            database: row.table_schema,
            tableName: row.table_name,
            indexName: row.index_name,
            isUnique: Number(row.non_unique) === 0,
            columns: [],
            keyParts: [],
            indexType: row.index_type,
            entries: [],
        };
        group.entries.push({
            seq: Number(row.seq_in_index),
            column: row.column_name,
            expression: row.expression ?? null,
            subPart: row.sub_part,
            collation: row.collation ?? null,
        });
        groups.set(key, group);
    }

    return Array.from(groups.values()).map(group => {
        const ordered = group.entries.sort((left, right) => left.seq - right.seq);
        const unsupportedFeatures = mysqlIndexUnsupportedFeatures(
            ordered,
            group.indexType,
        );
        return {
            database: group.database,
            tableName: group.tableName,
            indexName: group.indexName,
            isUnique: group.isUnique,
            columns: ordered
                .map(entry => entry.column)
                .filter((column): column is string => column !== null),
            keyParts: ordered.map(entry => entry.column
                ? { kind: 'column' as const, name: entry.column }
                : {
                    kind: 'expression' as const,
                    expression: entry.expression ?? '',
                }),
            unsupportedFeatures,
        };
    });
}

export interface ForeignKeyGroup {
    database: string;
    tableName: string;
    constraintName: string;
    columns: string[];
    referencedDatabase: string;
    referencedTable: string;
    referencedColumns: string[];
    deleteRule: string;
}

export function groupForeignKeys(foreignKeys: readonly ForeignKeyRow[]): ForeignKeyGroup[] {
    const groups: Map<string, ForeignKeyGroup & { entries: Array<{ position: number; column: string; referencedColumn: string }> }> = new Map();
    for (const row of foreignKeys) {
        const key = `${row.table_schema}\0${row.table_name}\0${row.constraint_name}`;
        const group = groups.get(key) ?? {
            database: row.table_schema,
            tableName: row.table_name,
            constraintName: row.constraint_name,
            columns: [],
            referencedDatabase: row.referenced_table_schema,
            referencedTable: row.referenced_table_name,
            referencedColumns: [],
            deleteRule: row.delete_rule,
            entries: [],
        };
        group.entries.push({
            position: Number(row.ordinal_position),
            column: row.column_name,
            referencedColumn: row.referenced_column_name,
        });
        groups.set(key, group);
    }

    return Array.from(groups.values()).map(group => {
        const ordered = group.entries.sort((left, right) => left.position - right.position);
        return {
            database: group.database,
            tableName: group.tableName,
            constraintName: group.constraintName,
            columns: ordered.map(entry => entry.column),
            referencedDatabase: group.referencedDatabase,
            referencedTable: group.referencedTable,
            referencedColumns: ordered.map(entry => entry.referencedColumn),
            deleteRule: group.deleteRule,
        };
    });
}

/** Foreign-key constraint names per database and table, for filtering their backing indexes. */
export function collectForeignKeyNames(foreignKeys: readonly ForeignKeyRow[]): Map<string, Map<string, Set<string>>> {
    const names: Map<string, Map<string, Set<string>>> = new Map();
    for (const row of foreignKeys) {
        const byTable = names.get(row.table_schema) ?? new Map<string, Set<string>>();
        const set = byTable.get(row.table_name) ?? new Set<string>();
        set.add(row.constraint_name);
        byTable.set(row.table_name, set);
        names.set(row.table_schema, byTable);
    }
    return names;
}
