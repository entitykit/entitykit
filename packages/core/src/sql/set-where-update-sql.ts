import type { EntityMetadata } from '../model/entity-metadata';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import type { PredicateNode } from '../query/expression/predicate-node';
import type { EntityUpdateValues } from '../types';
import {
    mappedUpdateValues,
    type MappedUpdateValue,
} from './mapped-update-values';
import { PredicateSqlCompiler } from './predicate-sql-compiler';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';

export function resolveMappedUpdateValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    candidate: unknown,
    label: string,
): readonly MappedUpdateValue[] {
    if (
        candidate === null ||
        typeof candidate !== 'object' ||
        !('values' in candidate) ||
        candidate.values === undefined
    ) {
        throw new Error(`${label} must set at least one property.`);
    }
    return mappedUpdateValues(
        metadata,
        candidate.values as EntityUpdateValues<TEntity>,
    );
}

export function buildSetWhereUpdate<TEntity extends object>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    entries: readonly MappedUpdateValue[],
    predicate: PredicateNode | undefined,
    label: string,
): SqlStatement {
    if (entries.length === 0) {
        throw new Error(`${label} must set at least one property.`);
    }
    if (predicate === undefined) {
        throw new Error(`${label} require a where predicate.`);
    }

    const parameters = new SqlParameterBag(dialect);
    const assignments = entries.map(({ property, value }) => {
        if (property.isPrimaryKey) {
            throw new Error(
                `${label} cannot update primary key property ` +
                `'${metadata.entityName}.${property.propertyName}'.`,
            );
        }
        return `${dialect.quoteIdentifier(property.columnName)} = ${
            parameters.add(toBoundPropertyValue(
                value,
                property,
                metadata.entityName,
            ))
        }`;
    });
    const where = new PredicateSqlCompiler(
        metadata,
        parameters,
        undefined,
        dialect,
    ).compile(predicate);

    return {
        text: `update ${dialect.quoteQualifiedIdentifier(
            metadata.schemaName,
            metadata.tableName,
        )} set ${assignments.join(', ')} where ${where}`,
        values: parameters.values,
    };
}
