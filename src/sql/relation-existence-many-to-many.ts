import type { RelationExistenceExpression } from '../query/relation-expression';
import { PredicateSqlCompiler } from './predicate-sql-compiler';
import type { SelectFragmentHost } from './select-fragment-host';
import type { SqlDialect } from './sql-dialect';
import type { SqlParameterBag } from './sql-statement';

/** Compiles relation existence through an explicit many-to-many join table. */
export class ManyToManyRelationExistenceSqlCompiler {
    constructor(
        private readonly dialect: SqlDialect,
        private readonly host: SelectFragmentHost,
    ) {}

    public compile(
        expression: RelationExistenceExpression,
        parameters: SqlParameterBag,
        rootAlias: string,
    ): string {
        const relationship = expression.relation.manyToManyRelationship;
        if (!relationship) {
            throw new Error(
                `Relation '${expression.navigationProperty}' is missing many-to-many metadata.`,
            );
        }

        const target = expression.relation.targetMetadata;
        const joinAlias = 'rel_join';
        const relatedAlias = 'rel';
        const orientation = manyToManyRelationOrientation(expression);
        const sourceKeyColumns =
            expression.relation.sourceMetadata.keyPropertiesMetadata.map(
                key => key.columnName,
            );
        const relatedPredicates = [
            orientation.currentJoinColumns
                .map(
                    (joinColumn, index) =>
                        `${this.host.columnSql(joinColumn, joinAlias)} = ${this.host.columnSql(sourceKeyColumns[index], rootAlias)}`,
                )
                .join(' and '),
        ];

        if (expression.predicate) {
            relatedPredicates.push(
                new PredicateSqlCompiler(
                    target,
                    parameters,
                    relatedAlias,
                    this.dialect,
                ).compile(expression.predicate.node),
            );
        }

        const subquery = [
            'select 1',
            `from ${this.dialect.quoteQualifiedIdentifier(relationship.joinSchemaName, relationship.joinTableName)} ${this.dialect.quoteIdentifier(joinAlias)}`,
            `join ${this.dialect.quoteQualifiedIdentifier(target.schemaName, target.tableName)} ${this.dialect.quoteIdentifier(relatedAlias)} on ${orientation.relatedJoinColumns.map((joinColumn, index) => `${this.host.columnSql(joinColumn, joinAlias)} = ${this.host.columnSql(target.keyPropertiesMetadata[index].columnName, relatedAlias)}`).join(' and ')}`,
            `where ${relatedPredicates.join(' and ')}`,
        ].join(' ');
        const exists = `exists(${subquery})`;
        return expression.operator === 'notExists' ? `not ${exists}` : exists;
    }
}

export interface ManyToManyRelationOrientation {
    readonly currentJoinColumns: readonly string[];
    readonly relatedJoinColumns: readonly string[];
    readonly direction: 'direct' | 'inverse';
}

/**
 * Resolve which side of the join table this navigation reads from. Shared with
 * the cache key so a query and its cached SQL agree on orientation.
 */
export function manyToManyRelationOrientation(
    expression: RelationExistenceExpression,
): ManyToManyRelationOrientation {
    const relationship = expression.relation.manyToManyRelationship;
    if (!relationship) {
        throw new Error(
            `Relation '${expression.navigationProperty}' is missing many-to-many metadata.`,
        );
    }

    if (relationship.navigationProperty === expression.navigationProperty) {
        return {
            currentJoinColumns: relationship.sourceForeignKeyColumns,
            relatedJoinColumns: relationship.targetForeignKeyColumns,
            direction: 'direct',
        };
    }

    if (
        (relationship.inverseNavigationProperty as unknown) === expression.navigationProperty
    ) {
        return {
            currentJoinColumns: relationship.targetForeignKeyColumns,
            relatedJoinColumns: relationship.sourceForeignKeyColumns,
            direction: 'inverse',
        };
    }

    throw new Error(
        `Relation '${expression.navigationProperty}' does not match configured many-to-many metadata.`,
    );
}
