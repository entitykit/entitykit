import type { ProjectionSqlNode } from '../query/projection';

export type ProjectionValueField = Extract<
    ProjectionSqlNode,
    { readonly kind: 'field' }
>;

/** Find the mapped field whose provider representation a value preserves. */
export function projectionValueField(
    node: ProjectionSqlNode | undefined,
): ProjectionValueField | undefined {
    if (node?.kind === 'field') {
        return node;
    }
    if (node?.kind !== 'call' || node.function !== 'coalesce') {
        return undefined;
    }
    const value = node.operands[0];
    const direct = projectionValueField(value);
    if (direct) {
        return direct;
    }
    return value.kind === 'literal' && value.value === null
        ? projectionValueField(node.operands[1])
        : undefined;
}
