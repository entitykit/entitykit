import type { EntityMetadata } from '../model/entity-metadata';
import { isSqlNull } from '../sql/predicate-null-semantics';
import { boundQueryValue, toBoundQueryPropertyValue } from './expression/bound-query-value';
import { PredicateExpression } from './expression/predicate-expression';
import type { PredicateNode } from './expression/predicate-node';
import type { IncludeFilterModel } from './query-model';

/** Own fixed operands once; key probes and chunks bind independent copies. */
export function bindIncludeFilter<TEntity extends object>(
    metadata: EntityMetadata<TEntity>, filter: IncludeFilterModel,
): IncludeFilterModel {
    return filter.predicate ? {
        ...filter, predicate: new PredicateExpression(bindPredicate(metadata, filter.predicate.node)),
    } : filter;
}

function bindPredicate<TEntity extends object>(metadata: EntityMetadata<TEntity>, node: PredicateNode): PredicateNode {
    switch (node.kind) {
        case 'logical':
            return { ...node, left: bindPredicate(metadata, node.left), right: bindPredicate(metadata, node.right) };
        case 'not':
            return { ...node, predicate: bindPredicate(metadata, node.predicate) };
        case 'null':
        case 'fieldComparison':
            return node;
        case 'binary': {
            const property = metadata.getProperty(node.propertyName);
            const bind = (value: unknown): unknown => isSqlNull(value)
                ? value : boundQueryValue(toBoundQueryPropertyValue(value, property, metadata.entityName));
            if (node.operator !== 'in') return { ...node, value: bind(node.value) };
            // Preserve unconverted nulls so IN keeps its existing IS NULL arm.
            if (!Array.isArray(node.value)) {
                throw new Error(`The 'in' operator for '${node.propertyName}' requires an array value.`);
            }
            return { ...node, value: node.value.map(bind) };
        }
    }
}
