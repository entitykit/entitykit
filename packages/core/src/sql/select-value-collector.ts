import type { EntityMetadata } from '../model/entity-metadata';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import { toBoundQueryPropertyValue } from '../query/expression/bound-query-value';
import type { BinaryOperator, PredicateNode } from '../query/expression/predicate-node';
import type { QueryModel } from '../query/query-model';
import type { ProjectionSqlNode } from '../query/projection';
import { isSqlNull, readInPredicateValues } from './predicate-null-semantics';
import { assertNever, stringPatternValue } from './select-sql-helpers';
import { projectionValueField } from './projection-expression-metadata';

/**
 * Recovers just the bound parameter values for a query whose SQL text was
 * served from the compile cache.
 *
 * The cache stores only the SQL string; on a hit the builder still needs the
 * positional values that go with it. This walk MUST visit the query in the same
 * order the SQL builder binds parameters — literal projections, then the
 * predicate (depth-first, left then right), then relation-existence predicates,
 * then limit, then offset — so the recovered array lines up with the `$n`
 * placeholders. Kept beside, and in lockstep with, that binding order.
 */
export function collectSelectValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    query: QueryModel<TEntity>,
): readonly unknown[] {
    const values: unknown[] = [];
    for (const projection of query.projection ?? []) {
        if (projection.kind === 'literal') {
            values.push(projection.value);
        } else if (projection.kind === 'computed') {
            collectProjectionValues(metadata, projection.expression, values);
        }
    }

    if (query.predicate) {
        collectPredicateValues(metadata, query.predicate.node, values);
    }
    for (const relation of query.relationExistence) {
        if (relation.predicate) {
            collectPredicateValues(relation.relation.targetMetadata, relation.predicate.node, values);
        }
    }
    if (query.limit !== undefined) {
        values.push(query.limit);
    }
    if (query.offset !== undefined) {
        values.push(query.offset);
    }
    return values;
}

function collectProjectionValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    node: ProjectionSqlNode,
    values: unknown[],
): void {
    switch (node.kind) {
        case 'field':
            return;
        case 'literal':
            values.push(node.value);
            return;
        case 'binary':
            collectProjectionValues(metadata, node.left, values);
            collectProjectionValues(metadata, node.right, values);
            return;
        case 'call': {
            const coalesceField = node.function === 'coalesce'
                ? projectionValueField(node.operands[0])
                : undefined;
            for (const [index, operand] of node.operands.entries()) {
                if (
                    index === 1 &&
                    operand.kind === 'literal' &&
                    coalesceField
                ) {
                    const property = metadata.getProperty(
                        coalesceField.propertyName,
                    );
                    values.push(toBoundPropertyValue(
                        operand.value,
                        property,
                        metadata.entityName,
                    ));
                } else {
                    collectProjectionValues(metadata, operand, values);
                }
            }
        }
    }
}

function collectPredicateValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    node: PredicateNode,
    values: unknown[],
): void {
    switch (node.kind) {
        case 'binary':
            collectBinaryValues(metadata, node.propertyName, node.operator, node.value, values);
            return;
        case 'fieldComparison':
            return;
        case 'null':
            return;
        case 'logical':
            collectPredicateValues(metadata, node.left, values);
            collectPredicateValues(metadata, node.right, values);
            return;
        case 'not':
            collectPredicateValues(metadata, node.predicate, values);
            return;
        default:
            assertNever(node);
    }
}

function collectBinaryValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    propertyName: string,
    operator: BinaryOperator,
    value: unknown,
    values: unknown[],
): void {
    if ((operator === 'eq' || operator === 'ne') && isSqlNull(value)) {
        return;
    }

    const property = metadata.getProperty(propertyName);
    if (operator === 'in') {
        const inValues = readInPredicateValues(
            value,
            `The 'in' operator for '${propertyName}' requires an array value.`,
        );
        for (const item of inValues.values) {
            values.push(toBoundQueryPropertyValue(
                item,
                property,
                metadata.entityName,
            ));
        }
        return;
    }

    values.push(stringPatternValue(
        operator,
        toBoundQueryPropertyValue(value, property, metadata.entityName),
    ));
}
