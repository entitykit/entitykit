import type { StoreGenerationStrategy } from '../../model/store-generation';

export function sqliteStoreGenerationClause(
    strategy: StoreGenerationStrategy,
    column: { readonly type: string; readonly isPrimaryKey: boolean },
): string {
    if (strategy.kind !== 'rowid') {
        throw new Error(
            `Store-generation strategy '${strategy.kind}' is not supported by the 'sqlite' provider.`,
        );
    }
    if (!column.isPrimaryKey || column.type.trim().toLowerCase() !== 'integer') {
        throw new Error(
            'SQLite rowid generation requires a single primary-key column whose declared type is exactly INTEGER.',
        );
    }
    return strategy.preventReuse ? 'autoincrement' : '';
}
