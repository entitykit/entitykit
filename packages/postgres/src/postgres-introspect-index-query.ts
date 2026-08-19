import type { DatabaseConnection } from '../../storage/database-connection';

export interface IndexRow extends Record<string, unknown> {
    table_schema: string;
    table_name: string;
    index_name: string;
    columns: unknown;
    is_unique: unknown;
    has_predicate: unknown;
    has_expression: unknown;
    has_included_columns: unknown;
    has_non_default_opclass: unknown;
    access_method?: string;
    is_valid?: unknown;
    key_parts?: unknown;
    included_columns?: unknown;
    predicate?: string | null;
}

export async function queryIndexes(
    database: DatabaseConnection,
    schemas: readonly string[],
): Promise<IndexRow[]> {
    const result = await database.query<IndexRow>({
        text: `select ns.nspname as table_schema, tbl.relname as table_name, idx.relname as index_name,
       array_agg(att.attname::text order by indexed_columns.ordinality)
         filter (where indexed_columns.ordinality <= pg_index.indnkeyatts) as columns,
       array_agg(pg_get_indexdef(pg_index.indexrelid, indexed_columns.ordinality::int, true)
         order by indexed_columns.ordinality)
         filter (where indexed_columns.ordinality <= pg_index.indnkeyatts) as key_parts,
       array_agg(att.attname::text order by indexed_columns.ordinality)
         filter (where indexed_columns.ordinality > pg_index.indnkeyatts) as included_columns,
       pg_get_expr(pg_index.indpred, pg_index.indrelid) as predicate,
       pg_index.indisunique as is_unique,
       pg_index.indpred is not null as has_predicate,
       access_method.amname as access_method,
       pg_index.indisvalid as is_valid,
       bool_or(indexed_columns.attnum = 0) as has_expression,
       pg_index.indnatts > pg_index.indnkeyatts as has_included_columns,
       bool_or(coalesce(not opclass.opcdefault, false))
         filter (where indexed_columns.ordinality <= pg_index.indnkeyatts) as has_non_default_opclass
from pg_index
join pg_class tbl on tbl.oid = pg_index.indrelid
join pg_namespace ns on ns.oid = tbl.relnamespace
join pg_class idx on idx.oid = pg_index.indexrelid
join pg_am access_method on access_method.oid = idx.relam
join unnest(pg_index.indkey) with ordinality as indexed_columns(attnum, ordinality) on true
left join pg_attribute att on att.attrelid = tbl.oid and att.attnum = indexed_columns.attnum
left join unnest(pg_index.indclass::oid[]) with ordinality as indexed_opclasses(opcoid, ordinality)
  on indexed_opclasses.ordinality = indexed_columns.ordinality
left join pg_opclass opclass on opclass.oid = indexed_opclasses.opcoid
where ns.nspname = any($1) and tbl.relkind in ('r', 'p')
  and pg_index.indisprimary = false
group by ns.nspname, tbl.relname, idx.relname, pg_index.indisunique,
         (pg_index.indpred is not null), pg_index.indnatts,
         pg_index.indnkeyatts, pg_index.indpred, pg_index.indrelid,
         pg_index.indexrelid, access_method.amname, pg_index.indisvalid
order by ns.nspname, tbl.relname, idx.relname`,
        values: [schemas],
    });
    return result.rows;
}
