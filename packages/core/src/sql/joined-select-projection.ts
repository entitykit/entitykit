import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import type { SqlDialect } from './sql-dialect';
import type { SqlParameterBag } from './sql-statement';
import {
    metadataForSource,
    normalizeSourceAlias,
} from './select-sql-helpers';
import { projectionColumnSql } from './projection-expression-sql';
import { toBoundPropertyValue } from '../model/value-converter/store-value';

export function buildJoinedSelectColumns<TEntity extends object>(
    dialect: SqlDialect,
    query: QueryModel<TEntity>,
    parameters: SqlParameterBag,
    sourceMetadata: ReadonlyMap<string, EntityMetadata>,
): string {
    return (query.projection ?? [])
        .map(projection => projectionColumnSql(
            dialect,
            projection,
            parameters,
            (sourceAlias, propertyName) => {
                const alias = normalizeSourceAlias(sourceAlias);
                const source = metadataForSource(sourceMetadata, alias);
                const property = source.getProperty(propertyName);
                return `${dialect.quoteIdentifier(alias)}.${dialect.quoteIdentifier(property.columnName)}`;
            },
            (sourceAlias, propertyName, value) => {
                const alias = normalizeSourceAlias(sourceAlias);
                const source = metadataForSource(sourceMetadata, alias);
                const property = source.getProperty(propertyName);
                return toBoundPropertyValue(
                    value,
                    property,
                    source.entityName,
                );
            },
        ))
        .join(', ');
}
