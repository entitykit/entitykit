import type { EntityMetadata } from '../model/entity-metadata';
import type { IndexMetadata } from '../model/index-metadata';
import { isAlternateKeyBackingIndex } from '../model/alternate-key-indexes';
import { defaultIndexName } from '../sql/identifiers';
import type { SqlDialect } from '../sql/sql-dialect';

export function buildIndexes(
    entity: EntityMetadata,
    dialect: SqlDialect,
): string[] {
    return entity.indexes
        .filter(index => !entity.alternateKeys.some(key =>
            isAlternateKeyBackingIndex(index, key.propertyNames)))
        .map(index => buildIndex(entity, index, dialect));
}

function buildIndex(
    entity: EntityMetadata,
    index: IndexMetadata,
    dialect: SqlDialect,
): string {
    const columns = (index.keyParts ?? index.propertyNames.map(propertyName => ({
        kind: 'property' as const,
        propertyName,
    })))
        .map(part => part.kind === 'property'
            ? dialect.quoteIdentifier(entity.getProperty(part.propertyName).columnName)
            : dialect.indexExpression?.(part.expression) ?? part.expression)
        .join(', ');
    const indexName = index.databaseName ?? defaultIndexName(
        index.isUnique,
        entity.tableName,
        index.propertyNames.map(
            propertyName => entity.getProperty(propertyName).columnName,
        ),
    );
    const unique = index.isUnique ? 'unique ' : '';
    const existenceGuard = dialect.createIndexExistenceGuard?.() ?? 'if not exists ';
    const included = (index.includedPropertyNames ?? []).map(propertyName =>
        dialect.quoteIdentifier(entity.getProperty(propertyName).columnName));
    const includeClause = included.length === 0
        ? ''
        : dialect.indexIncludeClause?.(included);
    if (includeClause === undefined) {
        throw new Error(`Covering indexes are not supported by the '${dialect.name}' provider.`);
    }
    const filterClause = index.filter === undefined
        ? ''
        : dialect.indexFilterClause?.(index.filter);
    if (filterClause === undefined) {
        throw new Error(`Partial indexes are not supported by the '${dialect.name}' provider.`);
    }

    return `create ${unique}index ${existenceGuard}${dialect.quoteIdentifier(
        indexName,
    )} on ${dialect.quoteQualifiedIdentifier(
        entity.schemaName, entity.tableName,
    )} (${columns})${includeClause}${filterClause};`;
}
