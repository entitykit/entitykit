import type { RelationExistenceExpression } from '../query/relation-expression';
import { PredicateSqlCompiler } from './predicate-sql-compiler';
import type { SelectFragmentHost } from './select-fragment-host';
import type { SqlDialect } from './sql-dialect';
import type { SqlParameterBag } from './sql-statement';
import { ManyToManyRelationExistenceSqlCompiler } from './relation-existence-many-to-many';
import { relationshipPrincipalKeyMetadata } from '../model/relationship-key';

/**
 * Compiles `whereExists` / `whereNotExists` relation filters on a root (single
 * source) query into correlated `exists(...)` subqueries.
 *
 * Direct and inverse foreign-key relations are correlated here on the whole
 * key. Join-table traversal lives in the many-to-many compiler. The row builder
 * owns the outer `select`/`from`/`where` and delegates each relation-existence
 * predicate here; both compilers borrow column qualification from the shared
 * fragment renderer.
 */
export class RelationExistenceSqlCompiler {
    private readonly manyToMany: ManyToManyRelationExistenceSqlCompiler;

    constructor(
        private readonly dialect: SqlDialect,
        private readonly host: SelectFragmentHost,
    ) {
        this.manyToMany = new ManyToManyRelationExistenceSqlCompiler(dialect, host);
    }

    public compile(
        expression: RelationExistenceExpression,
        parameters: SqlParameterBag,
        rootAlias: string,
    ): string {
        if (expression.relation.kind === 'manyToMany') {
            return this.manyToMany.compile(expression, parameters, rootAlias);
        }

        const relationship = expression.relation.relationship;
        if (!relationship) {
            throw new Error(`Relation '${expression.navigationProperty}' is missing relationship metadata.`);
        }

        const target = expression.relation.targetMetadata;
        const relatedAlias = 'rel';
        const relatedPredicates = [
            this.relationCorrelationPredicate(expression, rootAlias, relatedAlias),
        ];

        if (expression.predicate) {
            relatedPredicates.push(new PredicateSqlCompiler(target, parameters, relatedAlias, this.dialect).compile(expression.predicate.node));
        }

        const subquery = [
            'select 1',
            `from ${this.dialect.quoteQualifiedIdentifier(target.schemaName, target.tableName)} ${this.dialect.quoteIdentifier(relatedAlias)}`,
            `where ${relatedPredicates.join(' and ')}`,
        ].join(' ');
        const exists = `exists(${subquery})`;
        return expression.operator === 'notExists' ? `not ${exists}` : exists;
    }

    private relationCorrelationPredicate(
        expression: RelationExistenceExpression,
        rootAlias: string,
        relatedAlias: string,
    ): string {
        const relationship = expression.relation.relationship;
        if (!relationship) {
            throw new Error(`Relation '${expression.navigationProperty}' is missing relationship metadata.`);
        }

        // Correlate on every key column, so a composite key matches as a whole
        // rather than on its first part.
        if (
            expression.relation.kind === 'oneToMany' ||
            expression.relation.kind === 'oneToOne'
        ) {
            const principalKeys = relationshipPrincipalKeyMetadata(
                relationship,
                expression.relation.sourceMetadata,
            );
            const dependentForeignKeys = relationship.foreignKeyProperties
                .map(propertyName => expression.relation.targetMetadata.getProperty(propertyName).columnName);
            return this.correlationEquality(dependentForeignKeys, relatedAlias, principalKeys.map(key => key.columnName), rootAlias, expression);
        }

        const dependentForeignKeys = relationship.foreignKeyProperties
            .map(propertyName => expression.relation.sourceMetadata.getProperty(propertyName).columnName);
        const principalKeys = relationshipPrincipalKeyMetadata(
            relationship,
            expression.relation.targetMetadata,
        );
        return this.correlationEquality(principalKeys.map(key => key.columnName), relatedAlias, dependentForeignKeys, rootAlias, expression);
    }

    private correlationEquality(
        leftColumns: readonly string[],
        leftAlias: string,
        rightColumns: readonly string[],
        rightAlias: string,
        expression: RelationExistenceExpression,
    ): string {
        if (leftColumns.length !== rightColumns.length || leftColumns.length === 0) {
            throw new Error(
                `Relation '${expression.navigationProperty}' correlates ${String(leftColumns.length)} column(s) against ${String(rightColumns.length)}; the foreign key must cover the whole principal key.`,
            );
        }

        return leftColumns
            .map((column, index) => `${this.host.columnSql(column, leftAlias)} = ${this.host.columnSql(rightColumns[index], rightAlias)}`)
            .join(' and ');
    }
}

export {
    manyToManyRelationOrientation,
} from './relation-existence-many-to-many';
export type {
    ManyToManyRelationOrientation,
} from './relation-existence-many-to-many';
