import type { Model } from '../model/model';
import type { SqlDialect } from '../sql/sql-dialect';

export function buildCreateSchemaStatements(
    model: Model,
    dialect: SqlDialect,
): string[] {
    const schemaNames = new Set([
        ...model.entities
            .map(entity => entity.schemaName)
            .filter((schemaName): schemaName is string => Boolean(schemaName)),
        ...model.entities.flatMap(entity => entity.manyToManyRelationships
            .map(relationship => relationship.joinSchemaName)
            .filter((schemaName): schemaName is string => Boolean(schemaName))),
        ...model.sequences
            .map(sequence => sequence.schemaName)
            .filter((schemaName): schemaName is string => Boolean(schemaName)),
    ]);

    return Array.from(schemaNames).map(
        schemaName =>
            `create schema if not exists ${dialect.quoteIdentifier(schemaName)};`,
    );
}
