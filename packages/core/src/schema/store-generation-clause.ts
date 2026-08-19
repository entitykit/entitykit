import type { StoreGenerationStrategy } from '../model/store-generation';
import { validateStoreGeneration } from '../model/store-generation';
import type { SqlDialect } from '../sql/sql-dialect';

export function storeGenerationClause(
    dialect: SqlDialect,
    strategy: StoreGenerationStrategy | undefined,
    column: { readonly type: string; readonly isPrimaryKey: boolean },
): string | undefined {
    if (!strategy) {
        return undefined;
    }
    validateStoreGeneration(strategy);
    const clause = dialect.storeGenerationClause?.(strategy, column);
    if (clause === undefined) {
        throw new Error(
            `Store-generation strategy '${strategy.kind}' is not supported by the '${dialect.name}' provider.`,
        );
    }
    return clause || undefined;
}
