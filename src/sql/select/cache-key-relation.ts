import type {
    RelationExistenceExpression,
} from '../../query/relation-expression';
import {
    manyToManyRelationOrientation,
} from '../relation-existence-many-to-many';
import { predicateShape } from './cache-key-predicate';

export function relationExistenceShape(
    expression: RelationExistenceExpression,
): unknown {
    const relationship = expression.relation.relationship;
    const manyToMany = expression.relation.manyToManyRelationship;

    return {
        operator: expression.operator,
        navigationProperty: expression.navigationProperty,
        relationKind: expression.relation.kind,
        sourceEntityName: expression.relation.sourceMetadata.entityName,
        targetEntityName: expression.relation.targetMetadata.entityName,
        relationship: relationship
            ? {
                foreignKeyProperty: relationship.foreignKeyProperty,
            }
            : undefined,
        manyToMany: manyToMany
            ? {
                direction: manyToManyRelationOrientation(expression).direction,
                joinSchemaName: manyToMany.joinSchemaName,
                joinTableName: manyToMany.joinTableName,
                sourceForeignKeyColumn: manyToMany.sourceForeignKeyColumn,
                targetForeignKeyColumn: manyToMany.targetForeignKeyColumn,
            }
            : undefined,
        predicate: expression.predicate
            ? predicateShape(expression.predicate.node)
            : undefined,
    };
}
