import type { EntityShape } from './db-pull-codegen-types';
import {
    formatSkippedIndexMessage,
} from './db-pull-emit-helpers';
import { referencedAlternateKeyIndexes } from './db-pull-relationship-helpers';

export function renderIndexConfigurations(
    entity: EntityShape,
    allEntities: readonly EntityShape[],
): string[] {
    const lines: string[] = [];
    const alternateKeys = referencedAlternateKeyIndexes(entity, allEntities);
    for (const index of entity.table.indexes) {
        const parts = index.keyParts ?? index.columns.map(name => ({
            kind: 'column' as const,
            name,
        }));
        const columnParts = parts.filter(part => part.kind === 'column');
        const properties = columnParts
            .map(part => entity.propertiesByColumn.get(part.name))
            .filter((property): property is string => Boolean(property));
        const included = (index.includedColumns ?? [])
            .map(column => entity.propertiesByColumn.get(column))
            .filter((property): property is string => Boolean(property));
        if (
            parts.length === 0 ||
            properties.length !== columnParts.length ||
            included.length !== (index.includedColumns?.length ?? 0) ||
            index.unsupportedFeatures?.length
        ) {
            const unmapped = index.columns.filter(
                column => !entity.propertiesByColumn.has(column),
            );
            lines.push(
                `      // TODO: ${formatSkippedIndexMessage(entity.table, index, unmapped)}`,
            );
            continue;
        }

        const hasExpression = parts.some(part => part.kind === 'expression');
        const selector = renderSelector(properties);
        if (alternateKeys.has(index) && !hasExpression) {
            lines.push(
                `      entity.hasAlternateKey(${selector}).hasDatabaseName(${JSON.stringify(index.name)});`,
            );
            if (included.length === 0) {
                continue;
            }
        }
        const prefix = hasExpression
            ? `      entity.hasExpressionIndex(${JSON.stringify(parts.map(part =>
                part.kind === 'column' ? part.name : part.expression))}).hasDatabaseName(${JSON.stringify(index.name)})`
            : `      entity.hasIndex(${selector}).hasDatabaseName(${JSON.stringify(index.name)})`;
        lines.push(
            `${prefix}${index.isUnique ? '.isUnique()' : ''}` +
            (included.length > 0 ? `.includeProperties(row => ${renderProperties(included)})` : '') +
            `${index.filter ? `.hasFilter(${JSON.stringify(index.filter)})` : ''};`,
        );
    }
    return lines;
}

function renderSelector(properties: readonly string[]): string {
    return properties.length === 1
        ? `row => row.${properties[0]}`
        : `row => [${properties.map(property =>
            `row.${property}`).join(', ')}]`;
}

function renderProperties(properties: readonly string[]): string {
    return properties.length === 1
        ? `row.${properties[0]}`
        : `[${properties.map(property => `row.${property}`).join(', ')}]`;
}
