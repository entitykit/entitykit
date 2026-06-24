import { FieldExpression } from './expression/field-expression';
import type { OrderExpression } from './expression/order-expression';
import { PredicateExpression } from './expression/predicate-expression';
import type { QueryField } from './query-field-types';
import { cloneInclude, type IncludeExpression, type QueryModel } from './query-model';
import { includePathKey } from './include-expression';
import {
    isAggregateField,
    isGroupKeyField,
    HavingPredicateExpression,
    type AggregateField,
    type GroupKeyField,
} from './aggregate';
import type { AggregateOrderExpression as CompiledAggregateOrderExpression } from './aggregate-expression-types';
import type { AggregateOrderExpression } from './aggregate-order-types';
import type { SqlStatement } from '../sql/sql-statement';
import type { RelationExistenceMetadata } from './relation-expression';
import type { EntityUpdateValues } from '../types';
import { QueryCompilationError } from '../errors/query-errors';
import type { DatabaseOperationOptions, QueryStreamOptions } from '../storage/database-connection';

/**
 * Shared, executor-agnostic internals for the queryable builders.
 *
 * This is a deliberate *leaf* module: it holds the one contract every builder
 * talks to the execution layer through (`QueryExecutor`) plus the validation and
 * normalization helpers that more than one builder reuses. The builder classes
 * (`Queryable`, `ProjectedQueryable`, `GroupedQueryable`,
 * `AggregateProjectedQueryable`) each live in their own file and all depend on
 * this one. Because this module imports nothing from any `Queryable*` builder
 * file, those files can share these pieces without forming an import cycle —
 * which is exactly why the shared `QueryExecutor` type lives here rather than in
 * `Queryable.ts`.
 */
export interface QueryExecutor<TEntity extends object> {
    executeToArray(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<TEntity[]>;
    executeStream?(model: QueryModel<TEntity>, options?: QueryStreamOptions): AsyncIterable<TEntity>;
    executeCount(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<number>;
    executeExists(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<boolean>;
    executeProjectionToArray<TProjection extends Record<string, unknown>>(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<TProjection[]>;
    executeProjectionStream?<TProjection extends Record<string, unknown>>(model: QueryModel<TEntity>, options?: QueryStreamOptions): AsyncIterable<TProjection>;
    executeAggregateToArray<TProjection extends Record<string, unknown>>(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<TProjection[]>;
    executeAggregateStream?<TProjection extends Record<string, unknown>>(model: QueryModel<TEntity>, options?: QueryStreamOptions): AsyncIterable<TProjection>;
    executeUpdate?(
        model: QueryModel<TEntity>,
        values: EntityUpdateValues<TEntity>,
        options?: DatabaseOperationOptions,
    ): Promise<number>;
    executeDelete?(model: QueryModel<TEntity>, options?: DatabaseOperationOptions): Promise<number>;
    resolveRelationExistence?(navigationProperty: string): RelationExistenceMetadata;
    buildSelectSql?(model: QueryModel<TEntity>): SqlStatement;
    buildAggregateSql?(model: QueryModel<TEntity>): SqlStatement;
}

export function upsertInclude<TEntity extends object>(
    includes: ReadonlyArray<IncludeExpression<TEntity>>,
    include: IncludeExpression<TEntity>,
): Array<IncludeExpression<TEntity>> {
    const key = includePathKey(include.navigationPath);
    const existingIndex = includes.findIndex(item => includePathKey(item.navigationPath) === key);
    if (existingIndex === -1) {
        return [...includes.map(item => cloneInclude(item)), cloneInclude(include)];
    }

    return includes.map((item, index) => index === existingIndex ? cloneInclude(include) : cloneInclude(item));
}

export function normalizeOrdering<TEntity extends object>(
    selected: QueryField<unknown> | OrderExpression<TEntity>,
    defaultDirection: 'asc' | 'desc',
): OrderExpression<TEntity> {
    if ('direction' in selected) {
        return selected;
    }

    if (selected instanceof FieldExpression) {
        return {
            propertyName: selected.propertyName as OrderExpression<TEntity>['propertyName'],
            sourceAlias: selected.sourceAlias,
            direction: defaultDirection,
        };
    }

    throw new QueryCompilationError('orderBy selectors must return a query field or order expression.');
}

export function normalizeAggregateOrdering(
    selected: AggregateField | GroupKeyField | AggregateOrderExpression,
    defaultDirection: 'asc' | 'desc',
): CompiledAggregateOrderExpression {
    if ('direction' in selected) {
        if (!('operand' in selected)) {
            throw new QueryCompilationError(
                'grouped ordering expressions must be created by EntityKit.',
            );
        }
        return selected as CompiledAggregateOrderExpression;
    }

    if (isAggregateField(selected)) {
        return {
            operand: {
                kind: 'aggregate',
                function: selected.function,
                propertyName: selected.propertyName,
            },
            direction: defaultDirection,
        };
    }

    if (isGroupKeyField(selected)) {
        return {
            operand: {
                kind: 'groupKey',
                keyAlias: selected.keyAlias,
                expressionKind: selected.expressionKind,
                provider: selected.provider,
                precision: selected.precision,
                timeZone: selected.timeZone,
                sourceAlias: selected.sourceAlias,
                propertyName: selected.propertyName,
            },
            direction: defaultDirection,
        };
    }

    throw new QueryCompilationError('grouped orderBy selectors must return a group key, aggregate expression, or aggregate order expression.');
}

export function assertPredicateExpression(value: unknown, operation: string): asserts value is PredicateExpression {
    if (!(value instanceof PredicateExpression)) {
        throw new QueryCompilationError(`${operation} must return a predicate expression. Use field operators such as eq(), ne(), in(), isNull(), like(), or combine predicates with and()/or().`);
    }
}

export function assertHavingPredicateExpression(value: unknown, operation: string): asserts value is HavingPredicateExpression {
    if (!(value instanceof HavingPredicateExpression)) {
        throw new QueryCompilationError(`${operation} must return a having predicate expression. Use group key or aggregate operators such as eq(), gte(), in(), isNull(), or combine predicates with and()/or().`);
    }
}

export function assertNonNegativeInteger(value: number, operation: string): void {
    if (!Number.isInteger(value) || value < 0) {
        throw new QueryCompilationError(`${operation} count must be a non-negative integer.`);
    }
}
