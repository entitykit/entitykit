import type { ManyToManyMetadata } from '../model/many-to-many-metadata';
import {
    joinEndpointValues,
    type ManyToManyEndpointKey,
} from './modification-sql-helpers';
import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';

export function buildManyToManyInsert<TEntity extends object>(
    dialect: SqlDialect,
    relationship: ManyToManyMetadata<TEntity>,
    sourceKeyValues: ManyToManyEndpointKey,
    targetKeyValues: ManyToManyEndpointKey,
): SqlStatement {
    return buildManyToManyInsertBatch(
        dialect,
        relationship,
        [[sourceKeyValues, targetKeyValues]],
    );
}

export function buildManyToManyInsertBatch<TEntity extends object>(
    dialect: SqlDialect,
    relationship: ManyToManyMetadata<TEntity>,
    pairs: ReadonlyArray<readonly [unknown, unknown]>,
): SqlStatement {
    if (pairs.length === 0) {
        throw new Error('At least one many-to-many pair is required.');
    }

    const parameters = new SqlParameterBag(dialect);
    const columns = [
        ...relationship.sourceForeignKeyColumns,
        ...relationship.targetForeignKeyColumns,
    ];
    const values = pairs.map(([sourceKeyValues, targetKeyValues]) => {
        const rowValues = joinEndpointValues(
            relationship,
            sourceKeyValues,
            targetKeyValues,
        ).map(value => parameters.add(value));
        return `(${rowValues.join(', ')})`;
    });

    return {
        text: `insert into ${dialect.quoteQualifiedIdentifier(relationship.joinSchemaName, relationship.joinTableName)} (${columns.map(column => dialect.quoteIdentifier(column)).join(', ')}) values ${values.join(', ')} ${dialect.insertConflictDoNothingClause(columns)}`,
        values: parameters.values,
    };
}
