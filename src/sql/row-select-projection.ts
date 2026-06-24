import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import type { SelectFragmentHost } from './select-fragment-host';
import type { SqlDialect } from './sql-dialect';
import type { SqlParameterBag } from './sql-statement';
import { projectionColumnSql } from './projection-expression-sql';
import { toProviderValue } from '../model/value-converter/store-value';

export function buildRowSelectColumns<TEntity extends object>(
    dialect: SqlDialect,
    host: SelectFragmentHost,
    metadata: EntityMetadata<TEntity>,
    query: QueryModel<TEntity>,
    parameters: SqlParameterBag,
    rootAlias?: string,
): string {
    if (query.projection && query.projection.length > 0) {
        return query.projection
            .map(projection => projectionColumnSql(
                dialect,
                projection,
                parameters,
                (_sourceAlias, propertyName) => {
                    const property = metadata.getProperty(
                        propertyName,
                    );
                    return host.columnSql(property.columnName, rootAlias);
                },
                (_sourceAlias, propertyName, value) => {
                    const property = metadata.getProperty(propertyName);
                    return toProviderValue(
                        value,
                        property.converter as never,
                    );
                },
            ))
            .join(', ');
    }

    return metadata.properties
        .map(property => host.columnSql(property.columnName, rootAlias))
        .join(', ');
}
