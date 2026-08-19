import type { DatabaseColumn } from './database-schema';
import type { EntityShape } from './db-pull-codegen-types';
import type { StoreGenerationStrategy } from '../model/store-generation';
import { unsupportedStoreGeneration } from './db-pull-store-generation';

export function renderPropertyConfiguration(
    entity: EntityShape,
    column: DatabaseColumn,
): string {
    const propertyName = entity.propertiesByColumn.get(column.name);
    if (!propertyName) {
        throw new Error(
            `Entity '${entity.className}' has no property for column '${column.name}'.`,
        );
    }
    const fragments = [
        `      entity.property(row => row.${propertyName})`,
        `        .hasColumnName(${JSON.stringify(column.name)})`,
        `        .hasColumnType(${JSON.stringify(column.storeType)})`,
    ];

    if (!column.isNullable) {
        fragments.push('        .isRequired()');
    }

    if (column.collation) {
        fragments.push(`        .useCollation(${JSON.stringify(column.collation)})`);
    }

    const renderedStoreGeneration = unsupportedStoreGeneration(entity, column)
        ? undefined
        : column.storeGeneration;
    if (renderedStoreGeneration) {
        fragments.push(renderStoreGeneration(renderedStoreGeneration));
    } else if (column.generatedExpression) {
        fragments.push(
            `        .hasComputedColumnSql(${JSON.stringify(column.generatedExpression)}, ${String(column.generatedStored ?? true)})`,
        );
    } else if (column.defaultSql) {
        fragments.push(
            `        .hasDefaultSql(${JSON.stringify(column.defaultSql)})`,
        );
    }

    if (
        column.isStoreGenerated &&
        !renderedStoreGeneration &&
        !column.generatedExpression
    ) {
        fragments.push('        .valueGeneratedOnAdd()');
    }

    return `${fragments.join('\n')};`;
}

function renderStoreGeneration(strategy: StoreGenerationStrategy): string {
    switch (strategy.kind) {
        case 'identity':
            return `        .useIdentityColumn(${renderIdentityOptions(strategy)})`;
        case 'autoIncrement':
            return '        .useAutoIncrement()';
        case 'rowid':
            return strategy.preventReuse
                ? '        .useSqliteRowId({ preventReuse: true })'
                : '        .useSqliteRowId()';
        case 'sequence':
            return `        .useSequence(${JSON.stringify(strategy.name)}${
                strategy.schemaName
                    ? `, ${JSON.stringify(strategy.schemaName)}`
                    : ''
            })`;
    }
}

function renderIdentityOptions(
    strategy: Extract<StoreGenerationStrategy, { kind: 'identity' }>,
): string {
    const entries = [
        `mode: ${JSON.stringify(strategy.mode)}`,
        strategy.startValue === undefined
            ? undefined : `startValue: BigInt(${JSON.stringify(strategy.startValue)})`,
        strategy.incrementBy === undefined
            ? undefined : `incrementBy: BigInt(${JSON.stringify(strategy.incrementBy)})`,
        strategy.minValue === undefined
            ? undefined : `minValue: BigInt(${JSON.stringify(strategy.minValue)})`,
        strategy.maxValue === undefined
            ? undefined : `maxValue: BigInt(${JSON.stringify(strategy.maxValue)})`,
        `isCyclic: ${String(strategy.isCyclic)}`,
        strategy.cache === undefined ? undefined : `cache: ${String(strategy.cache)}`,
    ].filter((entry): entry is string => entry !== undefined);
    return `{ ${entries.join(', ')} }`;
}

export function renderDeleteBehavior(onDelete: string): string {
    const normalized = onDelete.toLowerCase().replace(/\s+/g, ' ');
    if (normalized === 'cascade') {
        return 'DeleteBehavior.Cascade';
    }
    if (normalized === 'set null') {
        return 'DeleteBehavior.SetNull';
    }
    if (normalized === 'restrict') {
        return 'DeleteBehavior.Restrict';
    }
    return 'DeleteBehavior.NoAction';
}
