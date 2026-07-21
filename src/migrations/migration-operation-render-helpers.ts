import type { ModelDiffOperation } from './model-differ';

export function isColumnRenameOnly(
    operation: Extract<
        ModelDiffOperation,
        { readonly kind: 'alterColumn' }
    >,
): boolean {
    return (
        Boolean(operation.column.oldName) &&
    operation.column.oldType === operation.column.type &&
    operation.column.oldNullable === operation.column.nullable &&
    operation.column.oldDefaultSql === operation.column.defaultSql &&
    operation.column.oldComputedSql === operation.column.computedSql &&
    operation.column.oldComputedStored === operation.column.computedStored &&
    operation.column.oldCollation === operation.column.collation &&
    JSON.stringify(operation.column.oldStoreGeneration) ===
        JSON.stringify(operation.column.storeGeneration)
    );
}

export function literalOptional(value: string | undefined): string {
    return value === undefined ? 'undefined' : JSON.stringify(value);
}

export function unsupportedOperation(value: never): never {
    throw new Error(
        `Unsupported migration operation: ${JSON.stringify(value)}`,
    );
}
