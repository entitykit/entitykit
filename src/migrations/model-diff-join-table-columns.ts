import type {
    CreateJoinTableOperation,
    DropJoinTableOperation,
} from './model-diff-operations';

interface LegacyJoinTableColumns {
    readonly sourceColumnName: string;
    readonly sourceForeignKeyColumn: string;
    readonly targetColumnName: string;
    readonly targetForeignKeyColumn: string;
}

export interface JoinTableColumnSets {
    readonly sourceColumns: readonly string[];
    readonly sourcePrincipalColumns: readonly string[];
    readonly targetColumns: readonly string[];
    readonly targetPrincipalColumns: readonly string[];
}

/** Normalize pre-composite diff operations alongside the current array shape. */
export function joinTableColumnSets(
    operation: CreateJoinTableOperation | DropJoinTableOperation,
): JoinTableColumnSets {
    const legacy: LegacyJoinTableColumns = operation;
    return {
        sourceColumns: operation.sourceForeignKeyColumns ??
            [legacy.sourceForeignKeyColumn],
        sourcePrincipalColumns: operation.sourceColumnNames ??
            [legacy.sourceColumnName],
        targetColumns: operation.targetForeignKeyColumns ??
            [legacy.targetForeignKeyColumn],
        targetPrincipalColumns: operation.targetColumnNames ??
            [legacy.targetColumnName],
    };
}
