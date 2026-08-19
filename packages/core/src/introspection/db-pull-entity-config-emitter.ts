import type {
    EntityShape,
    ManyToManyJoinShape,
} from './db-pull-codegen-types';
import {
    createForeignKeyNavigationNames,
    describeForeignKeyTarget,
    foreignKeyPropertiesFor,
    tableKey,
} from './db-pull-emit-helpers';
import {
    findForeignKeyTargetKey,
    foreignKeyIsUnique,
} from './db-pull-relationship-helpers';
import { renderPropertyConfiguration, renderDeleteBehavior } from './db-pull-property-config-emitter';
import { renderManyToManyConfiguration } from './db-pull-relationship-config-emitter';
import { renderIndexConfigurations } from './db-pull-index-config-emitter';

export function renderEntityConfiguration(
    entity: EntityShape,
    entityByTable: ReadonlyMap<string, EntityShape>,
    manyToManyJoins: readonly ManyToManyJoinShape[],
): string[] {
    const lines = [
        `    model.entity(${entity.className}, entity => {`,
        // An empty schema (MySQL's own database) is left off so the table stays
        // unqualified and bound to the connection's database, not a hardcoded name.
        entity.table.schemaName
            ? `      entity.${entity.table.objectType === 'view' ? 'toView' : 'toTable'}(${JSON.stringify(entity.table.tableName)}, ${JSON.stringify(entity.table.schemaName)});`
            : `      entity.${entity.table.objectType === 'view' ? 'toView' : 'toTable'}(${JSON.stringify(entity.table.tableName)});`,
    ];

    const keyColumns = entity.table.primaryKey?.columns ?? [];
    const keyProperties = keyColumns
        .map(column => entity.propertiesByColumn.get(column))
        .filter((property): property is string => Boolean(property));

    if (keyColumns.length === 0) {
        if (entity.table.objectType !== 'view') {
            lines.push('      entity.hasNoKey();');
        }
    } else if (keyProperties.length !== keyColumns.length) {
        lines.push(
            `      // TODO: Database primary key ${JSON.stringify(entity.table.primaryKey?.name ?? '')} has columns without mapped properties; configure the key manually.`,
        );
    } else if (keyProperties.length === 1) {
        lines.push(`      entity.hasKey(row => row.${keyProperties[0]});`);
    } else if (keyProperties.length > 1) {
        lines.push(
            `      entity.hasKey(row => [${keyProperties
                .map(property => `row.${property}`)
                .join(', ')}]);`,
        );
    }

    for (const column of entity.table.columns) {
        lines.push(renderPropertyConfiguration(entity, column));
    }
    for (const check of entity.table.checkConstraints ?? []) {
        lines.push(
            `      entity.hasCheckConstraint(${JSON.stringify(check.name)}, ${JSON.stringify(check.sql)});`,
        );
    }

    lines.push(...renderIndexConfigurations(
        entity,
        Array.from(entityByTable.values()),
    ));

    const foreignKeyNavigationNames = createForeignKeyNavigationNames(entity);
    for (const foreignKey of entity.table.foreignKeys) {
        const principal = entityByTable.get(
            tableKey(
                foreignKey.principalSchemaName,
                foreignKey.principalTableName,
            ),
        );
        const foreignKeyProperties = foreignKeyPropertiesFor(entity, foreignKey);
        const foreignKeyNavigationName = foreignKeyNavigationNames.get(foreignKey);
        if (!principal) {
            lines.push(
                `      // TODO: Skipped relationship ${JSON.stringify(foreignKey.name)} because ${describeForeignKeyTarget(foreignKey)} was not included in this db pull snapshot.`,
            );
            continue;
        }
        if (!foreignKeyProperties) {
            lines.push(
                `      // TODO: Skipped relationship ${JSON.stringify(foreignKey.name)} because local foreign-key column metadata was incomplete.`,
            );
            continue;
        }
        const targetKey = findForeignKeyTargetKey(foreignKey, principal);
        if (!targetKey) {
            lines.push(
                `      // TODO: Skipped relationship ${JSON.stringify(foreignKey.name)} because principal columns ${JSON.stringify(foreignKey.principalColumns)} do not match primary-key columns ${JSON.stringify(principal.table.primaryKey?.columns ?? [])}.`,
            );
            continue;
        }
        const foreignKeySelector = foreignKeyProperties.length === 1
            ? `row.${foreignKeyProperties[0]}`
            : `[${foreignKeyProperties
                .map(property => `row.${property}`)
                .join(', ')}]`;
        lines.push([
            `      entity.hasOne(${principal.className}, row => row.${String(foreignKeyNavigationName)})`,
            `        .${foreignKeyIsUnique(entity.table, foreignKey) ? 'withOne' : 'withMany'}()`,
            `        .hasForeignKey(row => ${foreignKeySelector})`,
            targetKey.kind === 'alternate'
                ? `        .hasPrincipalKey(row => ${renderPropertySelector(targetKey.properties)})`
                : undefined,
            `        .onDelete(${renderDeleteBehavior(foreignKey.onDelete)})`,
            `        .hasConstraintName(${JSON.stringify(foreignKey.name)});`,
        ].filter((line): line is string => line !== undefined).join('\n'));
    }

    for (const join of manyToManyJoins.filter(item => item.source === entity)) {
        lines.push(renderManyToManyConfiguration(join));
    }

    lines.push('    });', '');
    return lines;
}
function renderPropertySelector(properties: readonly string[]): string {
    return properties.length === 1
        ? `row.${properties[0]}`
        : `[${properties.map(property => `row.${property}`).join(', ')}]`;
}
