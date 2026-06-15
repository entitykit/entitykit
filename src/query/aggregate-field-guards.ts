import { FieldExpression } from './expression/field-expression';
import type { QueryField } from './query-field-types';
import {
    aggregateFieldSymbol,
    dateBucketGroupKeySymbol,
    groupKeyFieldSymbol,
} from './aggregate-symbols';
import type { DateBucketPrecision } from './aggregate-expression-types';
import type {
    AggregateField,
    DateBucketGroupKey,
    GroupKeyField,
} from './aggregate-field-contracts';

const dateBucketPrecisions: Set<DateBucketPrecision> = new Set([
    'hour',
    'day',
    'week',
    'month',
]);

export function isAggregateField(
    value: unknown,
): value is AggregateField {
    return Boolean(
        value &&
    typeof value === 'object' &&
    (value as Record<symbol, unknown>)[aggregateFieldSymbol] === true,
    );
}

export function isGroupKeyField(
    value: unknown,
): value is GroupKeyField {
    return Boolean(
        value &&
    typeof value === 'object' &&
    (value as Record<symbol, unknown>)[groupKeyFieldSymbol] === true,
    );
}

export function createDateBucketGroupKey(
    precision: DateBucketPrecision,
    field: QueryField<unknown>,
    options: { readonly timeZone: string },
): DateBucketGroupKey<Date | null> {
    if (!dateBucketPrecisions.has(precision)) {
        throw new Error(
            'Date bucket precision must be one of: hour, day, week, month.',
        );
    }
    if (!(field instanceof FieldExpression)) {
        throw new Error('Date bucket selectors must select a mapped query field.');
    }
    const candidate: unknown = options;
    if (
        candidate === null ||
        typeof candidate !== 'object' ||
        !('timeZone' in candidate) ||
        typeof candidate.timeZone !== 'string' ||
        candidate.timeZone.trim().length === 0
    ) {
        throw new Error(
            'Date bucket group keys require an explicit timeZone.',
        );
    }

    return {
        [dateBucketGroupKeySymbol]: true,
        provider: 'postgres',
        precision,
        timeZone: options.timeZone,
        sourceAlias: field.sourceAlias,
        propertyName: field.propertyName,
    };
}

export function isDateBucketGroupKey(
    value: unknown,
): value is DateBucketGroupKey<unknown> {
    return Boolean(
        value &&
    typeof value === 'object' &&
    (value as Record<symbol, unknown>)[dateBucketGroupKeySymbol] === true,
    );
}
