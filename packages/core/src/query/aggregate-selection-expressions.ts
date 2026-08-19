import { FieldExpression } from './expression/field-expression';
import type {
    AggregateExpression,
    GroupKeyExpression,
    GroupKeyProjectionExpression,
} from './aggregate-expression-types';
import {
    isAggregateField,
    isDateBucketGroupKey,
    isGroupKeyField,
} from './aggregate-field-guards';
import type {
    AggregateSelection,
    GroupedAggregateSelection,
    GroupKeySelection,
} from './aggregate-selection-types';

export function createGroupKeyExpressions(
    selection: GroupKeySelection,
): GroupKeyExpression[] {
    const expressions: GroupKeyExpression[] = [];
    const seenAliases: Set<string> = new Set();

    for (const [alias, field] of Object.entries(selection)) {
        if (seenAliases.has(alias)) {
            throw new Error(`Group key alias '${alias}' is already used.`);
        }
        seenAliases.add(alias);

        if (isDateBucketGroupKey(field)) {
            expressions.push({
                kind: 'dateBucket',
                alias,
                provider: field.provider,
                precision: field.precision,
                timeZone: field.timeZone,
                sourceAlias: field.sourceAlias,
                propertyName: field.propertyName,
            });
            continue;
        }
        if (!(field instanceof FieldExpression)) {
            throw new Error(
                `Group key alias '${alias}' must select a mapped query field or provider-owned group expression.`,
            );
        }
        expressions.push({
            kind: 'property',
            alias,
            sourceAlias: field.sourceAlias,
            propertyName: field.propertyName,
        });
    }

    if (expressions.length === 0) {
        throw new Error('groupBy selectors must select at least one key field.');
    }
    return expressions;
}

export function createAggregateExpressions(
    selection: AggregateSelection,
): AggregateExpression[] {
    const expressions: AggregateExpression[] = [];

    for (const [alias, field] of Object.entries(selection)) {
        if (!isAggregateField(field)) {
            throw new Error(
                `Aggregate projection alias '${alias}' must select an aggregate expression.`,
            );
        }
        expressions.push({
            alias,
            function: field.function,
            sourceAlias: field.sourceAlias,
            propertyName: field.propertyName,
        });
    }

    if (expressions.length === 0) {
        throw new Error(
            'Aggregate selectors must select at least one aggregate expression.',
        );
    }
    return expressions;
}

export function createGroupedAggregateExpressions(
    selection: GroupedAggregateSelection,
): {
    readonly aggregateProjection: AggregateExpression[];
    readonly groupKeyProjection: GroupKeyProjectionExpression[];
} {
    const aggregateProjection: AggregateExpression[] = [];
    const groupKeyProjection: GroupKeyProjectionExpression[] = [];

    for (const [alias, field] of Object.entries(selection)) {
        if (isAggregateField(field)) {
            aggregateProjection.push({
                alias,
                function: field.function,
                sourceAlias: field.sourceAlias,
                propertyName: field.propertyName,
            });
            continue;
        }
        if (isGroupKeyField(field)) {
            groupKeyProjection.push({
                kind: field.expressionKind,
                alias,
                keyAlias: field.keyAlias,
                provider: field.provider,
                precision: field.precision,
                timeZone: field.timeZone,
                sourceAlias: field.sourceAlias,
                propertyName: field.propertyName,
            } as GroupKeyProjectionExpression);
            continue;
        }
        throw new Error(
            `Grouped aggregate projection alias '${alias}' must select a group key or aggregate expression.`,
        );
    }

    if (
        aggregateProjection.length === 0 &&
    groupKeyProjection.length === 0
    ) {
        throw new Error(
            'Grouped aggregate selectors must select at least one group key or aggregate expression.',
        );
    }
    return { aggregateProjection, groupKeyProjection };
}
