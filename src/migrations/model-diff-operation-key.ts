import type { ModelDiffOperation } from './model-diff-operations';

export function operationKey(operation: ModelDiffOperation): string {
    if (!('tableName' in operation)) {
        return '';
    }
    return `${operation.schemaName ?? ''}.${operation.tableName}`;
}
