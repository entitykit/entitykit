import type { EntityConstructor } from '../types';
import type { QueryPlanShape } from '../diagnostics/runtime/events';
import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import { SelectSqlBuilder } from '../sql/select-sql-builder';
import type { SqlStatement } from '../sql/sql-statement';
import type { DbSetContext } from './db-set-context';
import type { DbSetDiagnostics } from './db-set-diagnostics';
import { startElapsedTimer } from '../diagnostics/runtime/elapsed-time';

export type DbSetQuerySqlKind =
  | 'select'
  | 'count'
  | 'exists'
  | 'aggregate';

interface QueryExecution<TResult> {
    readonly value: TResult;
    readonly rowCount: number;
    readonly resultCount: number;
}

/**
 * Instrumented SQL compilation and database execution phases for one DbSet.
 */
export class DbSetQueryPipeline<TEntity extends object> {
    private selectSql?: SelectSqlBuilder;

    constructor(
        private readonly context: DbSetContext,
        private readonly entityType: EntityConstructor<TEntity>,
        private readonly diagnostics: DbSetDiagnostics<TEntity>,
    ) {}

    public compile(
        kind: DbSetQuerySqlKind,
        model: QueryModel<TEntity>,
        shape: QueryPlanShape,
    ): SqlStatement {
        const elapsed = startElapsedTimer();
        try {
            const statement = this.buildStatement(kind, model);
            this.diagnostics.emitQueryPlan(
                'compile',
                shape,
                elapsed(),
                statement,
            );
            return statement;
        } catch (error) {
            this.diagnostics.emitQueryPlan(
                'compile',
                shape,
                elapsed(),
                undefined,
                undefined,
                undefined,
                error,
            );
            throw error;
        }
    }

    public async execute<TResult>(
        shape: QueryPlanShape,
        operation: () => Promise<QueryExecution<TResult>>,
        afterSuccess?: (value: TResult) => Promise<void>,
    ): Promise<TResult> {
        const elapsed = startElapsedTimer();
        try {
            const execution = await operation();
            this.diagnostics.emitQueryPlan(
                'execute',
                shape,
                elapsed(),
                undefined,
                execution.rowCount,
                execution.resultCount,
            );
            await afterSuccess?.(execution.value);
            return execution.value;
        } catch (error) {
            this.diagnostics.emitQueryPlan(
                'execute',
                shape,
                elapsed(),
                undefined,
                undefined,
                undefined,
                error,
            );
            throw error;
        }
    }

    private buildStatement(
        kind: DbSetQuerySqlKind,
        model: QueryModel<TEntity>,
    ): SqlStatement {
        switch (kind) {
            case 'select':
                return this.sql().build(this.metadata, model);
            case 'count':
                return this.sql().buildCount(this.metadata, model);
            case 'exists':
                return this.sql().buildExists(this.metadata, model);
            case 'aggregate':
                return this.sql().buildAggregate(this.metadata, model);
        }
    }

    private get metadata(): EntityMetadata<TEntity> {
        return this.context.modelMetadata.getEntity(this.entityType);
    }

    private sql(): SelectSqlBuilder {
        this.selectSql ??= new SelectSqlBuilder(this.context.dialect);
        return this.selectSql;
    }
}
