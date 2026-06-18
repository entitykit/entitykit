import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';
import type { SqlDialect } from '../sql/sql-dialect';
import { buildColumnType } from './column-type';
import { formatDefaultValue } from './default-value';
import { storeGenerationClause } from './store-generation-clause';

export function buildTableColumns(
    entity: EntityMetadata,
    dialect: SqlDialect,
): string[] {
    const foreignKeyColumns: Set<string> = new Set();
    for (const relationship of entity.relationships) {
        for (const propertyName of relationship.foreignKeyProperties) {
            foreignKeyColumns.add(entity.getProperty(propertyName).columnName);
        }
    }
    return entity.properties.map(property =>
        buildColumn(entity, property, foreignKeyColumns, dialect));
}

function buildColumn(
    entity: EntityMetadata,
    property: PropertyMetadata,
    foreignKeyColumns: ReadonlySet<string>,
    dialect: SqlDialect,
): string {
    const fragments = [
        dialect.quoteIdentifier(property.columnName),
        buildColumnType(
            property,
            property.isPrimaryKey || foreignKeyColumns.has(property.columnName),
            dialect,
        ),
    ];
    if (property.collation) {
        fragments.push(`collate ${dialect.quoteIdentifier(property.collation)}`);
    }
    if (
        !entity.isKeyless &&
        !entity.hasCompositeKey &&
        property.propertyName === entity.keyProperties[0]
    ) {
        fragments.push('primary key');
    } else if (property.isRequired) {
        fragments.push('not null');
    }
    const generation = storeGenerationClause(
        dialect,
        property.storeGeneration,
        {
            type: property.columnType,
            isPrimaryKey: property.isPrimaryKey,
        },
    );
    if (generation) {
        fragments.push(generation);
    }
    if (property.computedSql !== undefined) {
        const clause = dialect.generatedColumnClause?.(
            property.computedSql,
            property.computedStored ?? true,
        );
        if (!clause) {
            throw new Error(`Generated columns are not supported by the '${dialect.name}' provider.`);
        }
        fragments.push(clause);
    } else if (property.defaultSql !== undefined) {
        fragments.push(`default ${property.defaultSql}`);
    } else if (property.defaultValue !== undefined) {
        fragments.push(`default ${formatDefaultValue(property.defaultValue)}`);
    }
    return `  ${fragments.join(' ')}`;
}
