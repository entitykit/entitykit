import { QueryCompilationError } from '../errors/query-errors';
import type { QueryStreamOptions } from './database-connection';
export {
    isOperationAborted as isQueryAborted,
    throwIfOperationAborted as throwIfQueryAborted,
} from './operation-cancellation';

export const defaultQueryStreamBatchSize = 100;

export function queryStreamBatchSize(options: QueryStreamOptions = {}): number {
    const batchSize = options.batchSize ?? defaultQueryStreamBatchSize;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
        throw new QueryCompilationError(
            `stream() batchSize must be a positive safe integer, received ${String(batchSize)}.`,
        );
    }
    return batchSize;
}
