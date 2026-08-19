import type {
    DatabaseIndex,
    DatabaseSequence,
} from '../../introspection/database-schema';
import type { IndexRow } from './postgres-introspect-index-query';
import type { SequenceRow } from './postgres-introspect-schema-queries';
import {
    normalizePostgresBoolean,
    normalizePostgresStringArray,
} from './postgres-introspection-values';

export function toPostgresIndex(index: IndexRow): DatabaseIndex {
    const keyColumns = normalizeNullableStringArray(index.columns);
    const keyExpressions = normalizePostgresStringArray(index.key_parts);
    const keyParts = keyExpressions.length > 0
        ? keyExpressions.map((expression, position) => {
            const column = keyColumns[position];
            return column && isPlainColumnExpression(expression, column)
                ? { kind: 'column' as const, name: column }
                : { kind: 'expression' as const, expression };
        })
        : keyColumns.filter(
            (column): column is string => column !== null,
        ).map(name => ({ kind: 'column' as const, name }));
    return {
        name: index.index_name,
        columns: keyColumns.filter((column): column is string => column !== null),
        keyParts,
        includedColumns: normalizePostgresStringArray(index.included_columns),
        filter: typeof index.predicate === 'string' ? index.predicate : undefined,
        isUnique: normalizePostgresBoolean(index.is_unique),
        unsupportedFeatures: postgresIndexFeatures(index),
    };
}

export function toPostgresSequence(row: SequenceRow): DatabaseSequence {
    return {
        name: row.sequencename,
        schemaName: row.schemaname,
        dataType: row.data_type,
        startValue: String(row.start_value),
        incrementBy: String(row.increment_by),
        minValue: String(row.min_value),
        maxValue: String(row.max_value),
        isCyclic: normalizePostgresBoolean(row.cycle),
        cache: Number(row.cache_size),
    };
}

function postgresIndexFeatures(index: IndexRow): string[] | undefined {
    const features = [
        normalizePostgresBoolean(index.has_predicate) && !index.predicate
            ? 'partial predicate' : undefined,
        normalizePostgresBoolean(index.has_expression) && index.key_parts === undefined
            ? 'expression' : undefined,
        normalizePostgresBoolean(index.has_included_columns) &&
        index.included_columns === undefined ? 'included columns' : undefined,
        normalizePostgresBoolean(index.has_non_default_opclass) &&
        index.key_parts === undefined ? 'non-default operator class' : undefined,
        index.access_method !== undefined && index.access_method !== 'btree'
            ? `access method '${index.access_method}'` : undefined,
        index.is_valid !== undefined &&
        !normalizePostgresBoolean(index.is_valid)
            ? 'invalid index state' : undefined,
    ].filter((feature): feature is string => feature !== undefined);
    return features.length > 0 ? features : undefined;
}

function isPlainColumnExpression(expression: string, column: string): boolean {
    const normalized = expression.trim();
    return normalized === column || normalized === `"${column.replace(/"/g, '""')}"`;
}

function normalizeNullableStringArray(value: unknown): Array<string | null> {
    return Array.isArray(value)
        ? value.map(item => item === null ? null : String(item))
        : normalizePostgresStringArray(value);
}
