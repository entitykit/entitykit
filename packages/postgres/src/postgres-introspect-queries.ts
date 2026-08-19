import type { DatabaseConnection } from '../../storage/database-connection';
export interface ColumnRow extends Record<string, unknown> {
    table_schema: string;
    table_name: string;
    column_name: string;
    ordinal_position: number | string;
    data_type: string;
    udt_name: string;
    character_maximum_length: number | string | null;
    numeric_precision: number | string | null;
    numeric_scale: number | string | null;
    is_nullable: 'YES' | 'NO';
    column_default: string | null;
    is_identity: 'YES' | 'NO';
    identity_generation?: 'ALWAYS' | 'BY DEFAULT' | null;
    identity_start?: number | string | null;
    identity_increment?: number | string | null;
    identity_minimum?: number | string | null;
    identity_maximum?: number | string | null;
    identity_cycle?: 'YES' | 'NO' | boolean | null;
    identity_cache?: number | string | null;
    owned_sequence_schema?: string | null;
    owned_sequence_name?: string | null;
    table_type?: string;
    collation_name?: string | null;
    is_generated?: 'ALWAYS' | 'NEVER';
    generation_expression?: string | null;
}
export interface PrimaryKeyRow extends Record<string, unknown> {
    table_schema: string;
    table_name: string;
    constraint_name: string;
    columns: unknown;
    key_parts?: unknown;
    included_columns?: unknown;
    predicate?: string | null;
}
export interface ForeignKeyRow extends Record<string, unknown> {
    table_schema: string;
    table_name: string;
    constraint_name: string;
    columns: unknown;
    foreign_table_schema: string;
    foreign_table_name: string;
    foreign_columns: unknown;
    delete_rule: string;
}

export async function queryColumns(
    database: DatabaseConnection,
    schemas: readonly string[],
): Promise<ColumnRow[]> {
    const result = await database.query<ColumnRow>({
        text: `select c.table_schema, c.table_name, c.column_name, c.ordinal_position, c.data_type, c.udt_name,
       c.character_maximum_length, c.numeric_precision, c.numeric_scale, c.is_nullable,
       c.column_default, c.is_identity, c.identity_generation, c.identity_start,
       c.identity_increment, c.identity_minimum, c.identity_maximum, c.identity_cycle,
       c.collation_name, c.is_generated, c.generation_expression,
       owned_sequence.sequence_schema as owned_sequence_schema,
       owned_sequence.sequence_name as owned_sequence_name,
       owned_sequence.cache_size as identity_cache,
       t.table_type
from information_schema.columns c
join information_schema.tables t
  on t.table_schema = c.table_schema and t.table_name = c.table_name
left join lateral (
  select sequence_ns.nspname as sequence_schema,
         sequence_record.relname as sequence_name,
         sequence_data.seqcache as cache_size
  from pg_class table_record
  join pg_namespace table_ns on table_ns.oid = table_record.relnamespace
  join pg_attribute attribute_record
    on attribute_record.attrelid = table_record.oid
   and attribute_record.attname = c.column_name
  join pg_depend dependency
    on dependency.refobjid = table_record.oid
   and dependency.refobjsubid = attribute_record.attnum
   and dependency.classid = 'pg_class'::regclass
   and dependency.refclassid = 'pg_class'::regclass
   and dependency.deptype in ('a', 'i')
  join pg_class sequence_record
    on sequence_record.oid = dependency.objid
   and sequence_record.relkind = 'S'
  join pg_namespace sequence_ns on sequence_ns.oid = sequence_record.relnamespace
  join pg_sequence sequence_data on sequence_data.seqrelid = sequence_record.oid
  where table_ns.nspname = c.table_schema
    and table_record.relname = c.table_name
  limit 1
) owned_sequence on true
where c.table_schema = any($1)
order by c.table_schema, c.table_name, c.ordinal_position`,
        values: [schemas],
    });
    return result.rows;
}

export async function queryPrimaryKeys(
    database: DatabaseConnection,
    schemas: readonly string[],
): Promise<PrimaryKeyRow[]> {
    const result = await database.query<PrimaryKeyRow>({
        text: `select tc.table_schema, tc.table_name, tc.constraint_name, array_agg(kcu.column_name order by kcu.ordinal_position) as columns
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
 and tc.table_name = kcu.table_name
where tc.constraint_type = 'PRIMARY KEY'
  and tc.table_schema = any($1)
group by tc.table_schema, tc.table_name, tc.constraint_name`,
        values: [schemas],
    });
    return result.rows;
}

export async function queryForeignKeys(
    database: DatabaseConnection,
    schemas: readonly string[],
): Promise<ForeignKeyRow[]> {
    const result = await database.query<ForeignKeyRow>({
        text: `select tc.table_schema, tc.table_name, tc.constraint_name,
       array_agg(kcu.column_name order by kcu.ordinal_position) as columns,
       pk_kcu.table_schema as foreign_table_schema,
       pk_kcu.table_name as foreign_table_name,
       array_agg(pk_kcu.column_name order by kcu.ordinal_position) as foreign_columns,
       rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_catalog = kcu.constraint_catalog
 and tc.constraint_schema = kcu.constraint_schema
 and tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
 and tc.table_name = kcu.table_name
join information_schema.referential_constraints rc
  on rc.constraint_catalog = tc.constraint_catalog
 and rc.constraint_schema = tc.constraint_schema
 and rc.constraint_name = tc.constraint_name
join information_schema.key_column_usage pk_kcu
  on pk_kcu.constraint_catalog = rc.unique_constraint_catalog
 and pk_kcu.constraint_schema = rc.unique_constraint_schema
 and pk_kcu.constraint_name = rc.unique_constraint_name
 and pk_kcu.ordinal_position = kcu.position_in_unique_constraint
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = any($1)
group by tc.table_schema, tc.table_name, tc.constraint_name, pk_kcu.table_schema, pk_kcu.table_name, rc.delete_rule`,
        values: [schemas],
    });
    return result.rows;
}
