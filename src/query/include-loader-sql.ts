import { toProviderValue } from '../model/value-converter/store-value';
import type { EntityMetadata } from '../model/entity-metadata';
import type { OrderExpression } from './expression/order-expression';
import type { SqlDialect } from '../sql/sql-dialect';
import type { SqlParameterBag } from '../sql/sql-statement';
import type { IncludeFilterModel } from './query-model';
import type { ManyToManyRelationshipInfo } from './include-loader-context';

/**
 * SQL text fragments and aliases shared by the include subquery strategies.
 *
 * The batched and windowed loaders assemble raw SQL instead of going through
 * the select builder, because they carry an extra parent-key column and a
 * `row_number()` window the builder does not model. The reusable, dialect-only
 * pieces of that SQL -- the fixed aliases, the join and key predicates, the
 * window ordering, the outer projection, and the row-number filter -- are
 * collected here so the reference, one-to-many, and many-to-many strategies all
 * render them identically and none owns the others.
 */

export const parentKeyAlias = '__entitykit_parent_key';

/** Alias for the nth parent key column carried through an include subquery. */
export function parentKeyAliasAt(index: number): string {
    return index === 0 ? parentKeyAlias : `${parentKeyAlias}_${String(index)}`;
}

export const rowNumberAlias = '__entitykit_include_row_number';
export const includeSubqueryAlias = '__entitykit_include';

/** `j.<related column> = t.<key column>` for every column of the related key. */
export function relatedJoinPredicate(dialect: SqlDialect, info: ManyToManyRelationshipInfo): string {
    return info.relatedJoinColumns
        .map((joinColumn, index) => `${dialect.quoteIdentifier('j')}.${dialect.quoteIdentifier(joinColumn)} = ${dialect.quoteIdentifier('t')}.${dialect.quoteIdentifier(info.relatedMetadata.keyPropertiesMetadata[index].columnName)}`)
        .join(' and ');
}

/**
 * Restrict a join query to the given parent keys.
 *
 * One column keeps the compact `in (...)` form; several compile to an `or` of
 * `and`ed comparisons, one per key tuple. Keys come from tracked entities in
 * model form, so they are converted before being bound.
 */
export function joinKeyPredicate(
    dialect: SqlDialect,
    info: ManyToManyRelationshipInfo,
    currentKeys: ReadonlyArray<readonly unknown[]>,
    parameters: SqlParameterBag,
): string {
    const keyProperties = info.currentMetadata.keyPropertiesMetadata;
    const bind = (tuple: readonly unknown[], index: number): string =>
        parameters.add(toProviderValue(tuple[index], keyProperties[index].converter as never));

    if (info.currentJoinColumns.length === 1) {
        const column = `${dialect.quoteIdentifier('j')}.${dialect.quoteIdentifier(info.currentJoinColumns[0])}`;
        return `${column} in (${currentKeys.map(tuple => bind(tuple, 0)).join(', ')})`;
    }

    return currentKeys
        .map(tuple => `(${info.currentJoinColumns
            .map((column, index) => `${dialect.quoteIdentifier('j')}.${dialect.quoteIdentifier(column)} = ${bind(tuple, index)}`)
            .join(' and ')})`)
        .join(' or ');
}

export function includeOrderBy(
    dialect: SqlDialect,
    metadata: EntityMetadata,
    orderings: readonly OrderExpression[],
    tableAlias: string,
): string {
    if (orderings.length === 0) {
    // Key columns are non-null, so null placement never applies here. Include
    // every key part to keep paging deterministic for composite-keyed entities.
        return metadata.keyPropertiesMetadata
            .map(property =>
                `${dialect.quoteIdentifier(tableAlias)}.${dialect.quoteIdentifier(property.columnName)} asc`,
            )
            .join(', ');
    }

    // This ordering ranks rows inside `row_number() over (...)`, so it decides
    // *which* children a per-parent take/skip keeps. It must place nulls exactly
    // as the top-level order path does (SelectSqlBuilder.orderTerm) — SQL-standard,
    // nulls greater than any value — or the same filtered include would keep
    // different rows on Postgres (nulls already high) than on SQLite/MySQL (nulls
    // low by default). The dialect owns the placement via the same two hooks.
    return orderings
        .map(ordering => {
            const direction: 'asc' | 'desc' = ordering.direction === 'desc' ? 'desc' : 'asc';
            const column = `${dialect.quoteIdentifier(tableAlias)}.${dialect.quoteIdentifier(metadata.getProperty(ordering.propertyName).columnName)}`;
            const prefix = dialect.nullOrderingPrefix?.(column, direction) ?? '';
            const suffix = dialect.nullOrderingClause?.(direction) ?? '';
            return `${prefix}${column} ${direction}${suffix}`;
        })
        .join(', ');
}

export function includeOuterColumns(dialect: SqlDialect, metadata: EntityMetadata): string {
    return [
        `${dialect.quoteIdentifier(includeSubqueryAlias)}.${dialect.quoteIdentifier(parentKeyAlias)} as ${dialect.quoteIdentifier(parentKeyAlias)}`,
        ...metadata.properties.map(property => `${dialect.quoteIdentifier(includeSubqueryAlias)}.${dialect.quoteIdentifier(property.columnName)} as ${dialect.quoteIdentifier(property.columnName)}`),
    ].join(', ');
}

export function windowPredicate(dialect: SqlDialect, parameters: SqlParameterBag, filter: IncludeFilterModel): string {
    const rowNumber = `${dialect.quoteIdentifier(includeSubqueryAlias)}.${dialect.quoteIdentifier(rowNumberAlias)}`;
    const predicates: string[] = [];
    const offset = filter.offset ?? 0;

    if (offset > 0) {
        predicates.push(`${rowNumber} > ${parameters.add(offset)}`);
    }

    if (filter.limit !== undefined) {
        predicates.push(`${rowNumber} <= ${parameters.add(offset + filter.limit)}`);
    }

    return predicates.length > 0 ? predicates.join(' and ') : 'true';
}
