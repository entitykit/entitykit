import type { StoreGenerationStrategy } from '@entitykit/core/adapter';

export function mysqlStoreGenerationClause(
    strategy: StoreGenerationStrategy,
    column: { readonly type: string; readonly isPrimaryKey: boolean },
): string {
    if (strategy.kind !== 'autoIncrement') {
        throw new Error(
            `Store-generation strategy '${strategy.kind}' is not supported by the 'mysql' provider.`,
        );
    }
    if (!column.isPrimaryKey) {
        throw new Error(
            'MySQL auto-increment columns must be configured as the primary key so their required index exists when the table is created.',
        );
    }
    if (!isIntegerType(column.type)) {
        throw new Error('MySQL auto-increment columns must use an integer column type.');
    }
    return 'auto_increment';
}

function isIntegerType(type: string): boolean {
    return /^(?:tinyint|smallint|mediumint|int|integer|bigint|int2|int4|int8)(?:\s|\(|$)/
        .test(type.trim().toLowerCase());
}
