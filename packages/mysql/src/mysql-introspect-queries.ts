import type { DatabaseConnection } from '@entitykit/core/adapter';

export interface TableRow extends Record<string, unknown> {
    table_schema: string;
    table_name: string;
    table_type?: string;
}

export interface ColumnRow extends Record<string, unknown> {
    table_schema: string;
    table_name: string;
    column_name: string;
    ordinal_position: number | string;
    column_type: string;
    is_nullable: 'YES' | 'NO';
    column_default: string | null;
    extra: string | null;
    collation_name: string | null;
    generation_expression?: string | null;
}

export interface StatisticRow extends Record<string, unknown> {
    table_schema: string;
    table_name: string;
    index_name: string;
    non_unique: number | string;
    seq_in_index: number | string;
    column_name: string | null;
    sub_part: number | string | null;
    expression?: string | null;
    collation?: 'A' | 'D' | null;
    index_type?: string;
}

export interface ForeignKeyRow extends Record<string, unknown> {
    table_schema: string;
    table_name: string;
    constraint_name: string;
    column_name: string;
    ordinal_position: number | string;
    referenced_table_schema: string;
    referenced_table_name: string;
    referenced_column_name: string;
    delete_rule: string;
}

export interface CheckConstraintRow extends Record<string, unknown> {
    constraint_schema: string;
    table_name: string;
    constraint_name: string;
    check_clause: string;
}

export async function queryBaseTables(
    database: DatabaseConnection,
    databases: readonly string[],
): Promise<TableRow[]> {
    const result = await database.query<TableRow>({
        text: `select table_schema as table_schema, table_name as table_name, table_type as table_type
from information_schema.tables
where table_type in ('BASE TABLE', 'VIEW') and table_schema in (${placeholders(databases)})`,
        values: [...databases],
    });
    return result.rows;
}

export async function queryColumns(
    database: DatabaseConnection,
    databases: readonly string[],
): Promise<ColumnRow[]> {
    const result = await database.query<ColumnRow>({
        text: `select table_schema as table_schema, table_name as table_name, column_name as column_name,
       ordinal_position as ordinal_position, column_type as column_type,
       is_nullable as is_nullable, column_default as column_default,
       extra as extra, collation_name as collation_name,
       generation_expression as generation_expression
from information_schema.columns
where table_schema in (${placeholders(databases)})
order by table_schema, table_name, ordinal_position`,
        values: [...databases],
    });
    return result.rows;
}

export async function queryStatistics(
    database: DatabaseConnection,
    databases: readonly string[],
): Promise<StatisticRow[]> {
    const result = await database.query<StatisticRow>({
        text: `select table_schema as table_schema, table_name as table_name, index_name as index_name,
       non_unique as non_unique, seq_in_index as seq_in_index,
       column_name as column_name, sub_part as sub_part, expression as expression,
       collation as collation, index_type as index_type
from information_schema.statistics
where table_schema in (${placeholders(databases)})
order by table_schema, table_name, index_name, seq_in_index`,
        values: [...databases],
    });
    return result.rows;
}

export async function queryCheckConstraints(
    database: DatabaseConnection,
    databases: readonly string[],
): Promise<CheckConstraintRow[]> {
    const result = await database.query<CheckConstraintRow>({
        text: `select tc.constraint_schema as constraint_schema, tc.table_name as table_name,
       tc.constraint_name as constraint_name, cc.check_clause as check_clause
from information_schema.table_constraints tc
join information_schema.check_constraints cc
  on cc.constraint_schema = tc.constraint_schema
 and cc.constraint_name = tc.constraint_name
where tc.constraint_type = 'CHECK'
  and tc.constraint_schema in (${placeholders(databases)})
order by tc.constraint_schema, tc.table_name, tc.constraint_name`,
        values: [...databases],
    });
    return result.rows;
}

export async function queryForeignKeys(
    database: DatabaseConnection,
    databases: readonly string[],
): Promise<ForeignKeyRow[]> {
    const result = await database.query<ForeignKeyRow>({
        text: `select kcu.table_schema as table_schema, kcu.table_name as table_name, kcu.constraint_name as constraint_name,
       kcu.column_name as column_name, kcu.ordinal_position as ordinal_position,
       kcu.referenced_table_schema as referenced_table_schema, kcu.referenced_table_name as referenced_table_name,
       kcu.referenced_column_name as referenced_column_name, rc.delete_rule as delete_rule
from information_schema.key_column_usage kcu
join information_schema.referential_constraints rc
  on rc.constraint_schema = kcu.constraint_schema
 and rc.constraint_name = kcu.constraint_name
 and rc.table_name = kcu.table_name
where kcu.table_schema in (${placeholders(databases)})
  and kcu.referenced_table_name is not null
order by kcu.table_schema, kcu.table_name, kcu.constraint_name, kcu.ordinal_position`,
        values: [...databases],
    });
    return result.rows;
}

function placeholders(values: readonly unknown[]): string {
    return values.map(() => '?').join(', ');
}
