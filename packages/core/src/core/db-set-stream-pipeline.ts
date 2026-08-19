import type { QueryPlanShape } from '../diagnostics/runtime/events';
import type { DbSetDiagnostics } from './db-set-diagnostics';
import { startElapsedTimer } from '../diagnostics/runtime/elapsed-time';

/** Add query-plan execution diagnostics around one lazy row stream. */
export function instrumentDbSetStream<TEntity extends object, TResult>(
    diagnostics: DbSetDiagnostics<TEntity>,
    shape: QueryPlanShape,
    rows: AsyncIterable<TResult>,
): AsyncIterable<TResult> {
    return {
        async *[Symbol.asyncIterator]() {
            const elapsed = startElapsedTimer();
            let resultCount = 0;
            let failed = false;
            try {
                for await (const row of rows) {
                    resultCount++;
                    yield row;
                }
            } catch (error) {
                failed = true;
                diagnostics.emitQueryPlan(
                    'execute',
                    shape,
                    elapsed(),
                    undefined,
                    undefined,
                    undefined,
                    error,
                );
                throw error;
            } finally {
                if (!failed) {
                    diagnostics.emitQueryPlan(
                        'execute',
                        shape,
                        elapsed(),
                        undefined,
                        resultCount,
                        resultCount,
                    );
                }
            }
        },
    };
}
