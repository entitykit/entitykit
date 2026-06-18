import type { DatabaseConnection } from '../../storage/database-connection';

export interface CheckConstraintRow extends Record<string, unknown> {
    table_schema: string;
    table_name: string;
    constraint_name: string;
    expression: string;
}

export interface SequenceRow extends Record<string, unknown> {
    schemaname: string;
    sequencename: string;
    data_type: 'smallint' | 'integer' | 'bigint';
    start_value: number | string;
    min_value: number | string;
    max_value: number | string;
    increment_by: number | string;
    cycle: boolean;
    cache_size: number | string;
}

export async function queryCheckConstraints(
    database: DatabaseConnection,
    schemas: readonly string[],
): Promise<CheckConstraintRow[]> {
    const result = await database.query<CheckConstraintRow>({
        text: `select ns.nspname as table_schema, tbl.relname as table_name,
       constraint_record.conname as constraint_name,
       pg_get_expr(constraint_record.conbin, constraint_record.conrelid) as expression
from pg_constraint constraint_record
join pg_class tbl on tbl.oid = constraint_record.conrelid
join pg_namespace ns on ns.oid = tbl.relnamespace
where constraint_record.contype = 'c' and ns.nspname = any($1)
order by ns.nspname, tbl.relname, constraint_record.conname`,
        values: [schemas],
    });
    return result.rows;
}

export async function querySequences(
    database: DatabaseConnection,
    schemas: readonly string[],
): Promise<SequenceRow[]> {
    const result = await database.query<SequenceRow>({
        text: `select schemaname, sequencename, data_type, start_value, min_value,
       max_value, increment_by, cycle, cache_size
from pg_sequences sequence_view
join pg_namespace sequence_ns
  on sequence_ns.nspname = sequence_view.schemaname
join pg_class sequence_record
  on sequence_record.relnamespace = sequence_ns.oid
 and sequence_record.relname = sequence_view.sequencename
 and sequence_record.relkind = 'S'
where schemaname = any($1)
  and not exists (
    select 1
    from pg_depend dependency
    where dependency.classid = 'pg_class'::regclass
      and dependency.objid = sequence_record.oid
      and dependency.deptype = 'i'
  )
order by schemaname, sequencename`,
        values: [schemas],
    });
    return result.rows;
}
