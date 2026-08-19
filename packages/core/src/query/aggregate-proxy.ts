/**
 * Runtime factories that build the entity-facing proxies a caller selects
 * against: the aggregate proxy (`aggregate.count()/sum()/avg()/min()/max()`)
 * and, layered on top, the grouped proxy that also exposes `aggregate.key.*`.
 *
 * Separated from the selection-compiling factories (`AggregateExpressions`)
 * because these produce the *field objects* a caller composes, whereas those
 * consume a finished selection. Both proxies stamp brand symbols and borrow the
 * shared `havingOperators` builder for their fluent HAVING surface.
 */

import { FieldExpression } from './expression/field-expression';
import type { QueryFieldRef } from './expression/predicate-node';
import type { QueryField, QueryProxy } from './query-field-types';
import { createQueryProxy } from './query-proxy';
import { aggregateFieldSymbol, groupKeyFieldSymbol } from './aggregate-symbols';
import { havingOperators } from './aggregate-having';
import type {
    AggregateFunction,
    GroupKeyExpression,
} from './aggregate-expression-types';
import type {
    AggregateField,
    GroupKeyField,
} from './aggregate-field-contracts';
import type {
    AggregateProxy,
    GroupedAggregateProxy,
    GroupKeyProxy,
} from './aggregate-proxy-types';

export function createAggregateProxy<TEntity extends object, TSelectorProxy = QueryProxy<TEntity>>(
    selectorProxy: TSelectorProxy = createQueryProxy<TEntity>() as TSelectorProxy,
): AggregateProxy<TEntity, TSelectorProxy> {
    return {
        count<TProperty>(selector?: (entity: TSelectorProxy) => QueryField<TProperty>): AggregateField<number> {
            return aggregateField('count', selector ? aggregateFieldRef('count', selector, selectorProxy) : undefined);
        },
        sum(selector: (entity: TSelectorProxy) => QueryField<number | null>): AggregateField<number | null> {
            return aggregateField('sum', aggregateFieldRef('sum', selector, selectorProxy));
        },
        avg(selector: (entity: TSelectorProxy) => QueryField<number | null>): AggregateField<number | null> {
            return aggregateField('avg', aggregateFieldRef('avg', selector, selectorProxy));
        },
        min<TProperty extends number | string | Date>(
            selector: (entity: TSelectorProxy) => QueryField<TProperty | null>,
        ): AggregateField<TProperty | null> {
            return aggregateField('min', aggregateFieldRef('min', selector, selectorProxy));
        },
        max<TProperty extends number | string | Date>(
            selector: (entity: TSelectorProxy) => QueryField<TProperty | null>,
        ): AggregateField<TProperty | null> {
            return aggregateField('max', aggregateFieldRef('max', selector, selectorProxy));
        },
    };
}

export function createGroupedAggregateProxy<TEntity extends object, TKeySelection extends Record<string, unknown>, TSelectorProxy = QueryProxy<TEntity>>(
    groupKeys: readonly GroupKeyExpression[],
    selectorProxy?: TSelectorProxy,
): GroupedAggregateProxy<TEntity, TKeySelection, TSelectorProxy> {
    const aggregate = createAggregateProxy<TEntity, TSelectorProxy>(selectorProxy) as AggregateProxy<TEntity, TSelectorProxy> & { key: GroupKeyProxy<TKeySelection> };
    aggregate.key = createGroupKeyProxy<TKeySelection>(groupKeys);
    return aggregate;
}

function aggregateField<TResult>(func: AggregateFunction, field?: QueryFieldRef): AggregateField<TResult> {
    return {
        [aggregateFieldSymbol]: true,
        function: func,
        sourceAlias: field?.sourceAlias,
        propertyName: field?.propertyName,
        ...havingOperators({ kind: 'aggregate', function: func, sourceAlias: field?.sourceAlias, propertyName: field?.propertyName }),
    };
}

function createGroupKeyProxy<TKeySelection extends Record<string, unknown>>(
    groupKeys: readonly GroupKeyExpression[],
): GroupKeyProxy<TKeySelection> {
    const keysByAlias = new Map(groupKeys.map(key => [key.alias, key]));

    return new Proxy({}, {
        get(_target, propertyKey): GroupKeyField {
            if (typeof propertyKey !== 'string') {
                throw new Error('Group key selectors must access string-named keys.');
            }

            const key = keysByAlias.get(propertyKey);
            if (!key) {
                throw new Error(`Group key '${propertyKey}' was not selected in groupBy().`);
            }

            return {
                [groupKeyFieldSymbol]: true,
                keyAlias: key.alias,
                expressionKind: key.kind,
                provider: key.kind === 'dateBucket' ? key.provider : undefined,
                precision: key.kind === 'dateBucket' ? key.precision : undefined,
                timeZone: key.kind === 'dateBucket' ? key.timeZone : undefined,
                sourceAlias: key.sourceAlias,
                propertyName: key.propertyName,
                ...havingOperators({
                    kind: 'groupKey',
                    keyAlias: key.alias,
                    expressionKind: key.kind,
                    provider: key.kind === 'dateBucket' ? key.provider : undefined,
                    precision: key.kind === 'dateBucket' ? key.precision : undefined,
                    timeZone: key.kind === 'dateBucket' ? key.timeZone : undefined,
                    sourceAlias: key.sourceAlias,
                    propertyName: key.propertyName,
                }),
            };
        },
    }) as GroupKeyProxy<TKeySelection>;
}

function aggregateFieldRef<TSelectorProxy, TProperty>(
    func: AggregateFunction,
    selector: (entity: TSelectorProxy) => QueryField<TProperty>,
    selectorProxy: TSelectorProxy,
): QueryFieldRef {
    const selected = selector(selectorProxy);
    if (selected instanceof FieldExpression) {
        return selected.toFieldRef();
    }

    throw new Error(`Aggregate ${func} selectors must return a mapped query field.`);
}
