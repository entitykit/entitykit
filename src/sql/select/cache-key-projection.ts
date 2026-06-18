import type {
    ProjectionExpression,
    ProjectionSqlNode,
} from '../../query/projection';

export function projectionShape(
    projection: ProjectionExpression,
): unknown {
    const output = {
        alias: projection.alias,
        path: projection.path,
        kind: projection.kind,
    };
    if (projection.kind === 'literal') {
        return {
            ...output,
            valueShape:
                projection.value === null
                    ? 'null'
                    : typeof projection.value,
        };
    }
    if (projection.kind === 'field') {
        return {
            ...output,
            sourceAlias: projection.sourceAlias,
            propertyName: projection.propertyName,
        };
    }
    return {
        ...output,
        expression: projectionNodeShape(projection.expression),
        materialization: projection.materialization,
    };
}

function projectionNodeShape(node: ProjectionSqlNode): unknown {
    switch (node.kind) {
        case 'field':
            return {
                kind: node.kind,
                sourceAlias: node.sourceAlias,
                propertyName: node.propertyName,
            };
        case 'literal':
            return {
                kind: node.kind,
                valueShape:
                    node.value === null ? 'null' : typeof node.value,
            };
        case 'binary':
            return {
                kind: node.kind,
                operator: node.operator,
                left: projectionNodeShape(node.left),
                right: projectionNodeShape(node.right),
            };
        case 'call':
            return {
                kind: node.kind,
                function: node.function,
                operands: node.operands.map(projectionNodeShape),
            };
    }
}
