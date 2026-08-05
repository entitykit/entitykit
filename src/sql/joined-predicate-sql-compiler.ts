import type { EntityMetadata } from '../model/entity-metadata';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import type { BinaryOperator, PredicateNode, QueryFieldRef } from '../query/expression/predicate-node';
import { compileInPredicate, isSqlNull, readInPredicateValues } from './predicate-null-semantics';
import { assertNever, likeEscapeClause, metadataForSource, normalizeSourceAlias, sqlBinaryOperator, stringPatternValue } from './select-sql-helpers';
import type { SqlDialect } from './sql-dialect';
import type { SqlParameterBag } from './sql-statement';

/**
 * The multi-source (joined) mirror of {@link PredicateSqlCompiler}: it resolves
 * every field reference through the alias -> metadata map so `where` and `on`
 * clauses can name columns across joined sources. The select builder owns the
 * `select`/`from`/join orchestration and delegates predicate rendering here;
 * both the joined and aggregate paths share this one compiler.
 */
export class JoinedPredicateSqlCompiler {
    constructor(private readonly dialect: SqlDialect) {}

    public compile(
        node: PredicateNode,
        parameters: SqlParameterBag,
        sourceMetadata: ReadonlyMap<string, EntityMetadata>,
    ): string {
        switch (node.kind) {
            case 'binary':
                return this.compileBinary(node.sourceAlias, node.propertyName, node.operator, node.value, parameters, sourceMetadata);
            case 'fieldComparison': {
                const operator = node.operator === 'eq' ? '=' : '<>';
                return `${this.column(node.left, sourceMetadata)} ${operator} ${this.column(node.right, sourceMetadata)}`;
            }
            case 'null':
                return `${this.column({ sourceAlias: node.sourceAlias, propertyName: node.propertyName }, sourceMetadata)} ${node.operator === 'isNull' ? 'is null' : 'is not null'}`;
            case 'logical':
                return `(${this.compile(node.left, parameters, sourceMetadata)} ${node.operator} ${this.compile(node.right, parameters, sourceMetadata)})`;
            case 'not':
                return `(not ${this.compile(node.predicate, parameters, sourceMetadata)})`;
            default:
                return assertNever(node);
        }
    }

    private compileBinary(
        sourceAlias: string | undefined,
        propertyName: string,
        operator: BinaryOperator,
        value: unknown,
        parameters: SqlParameterBag,
        sourceMetadata: ReadonlyMap<string, EntityMetadata>,
    ): string {
        const column = this.column({ sourceAlias, propertyName }, sourceMetadata);

        if ((operator === 'eq' || operator === 'ne') && isSqlNull(value)) {
            return `${column} ${operator === 'eq' ? 'is null' : 'is not null'}`;
        }

        const source = metadataForSource(sourceMetadata, normalizeSourceAlias(sourceAlias));
        const property = source.getProperty(propertyName);

        if (operator === 'in') {
            return compileInPredicate(
                column,
                readInPredicateValues(
                    value,
                    `The 'in' operator for '${propertyName}' requires an array value.`,
                ),
                item => parameters.add(
                    toBoundPropertyValue(item, property, source.entityName),
                ),
                () => this.dialect.falsePredicate(),
            );
        }

        const sqlOperator = sqlBinaryOperator(operator);
        const parameterValue = stringPatternValue(
            operator,
            toBoundPropertyValue(value, property, source.entityName),
        );
        return `${column} ${sqlOperator} ${parameters.add(parameterValue)}${likeEscapeClause(operator)}`;
    }

    private column(
        field: QueryFieldRef,
        sourceMetadata: ReadonlyMap<string, EntityMetadata>,
    ): string {
        const sourceAlias = normalizeSourceAlias(field.sourceAlias);
        const source = metadataForSource(sourceMetadata, sourceAlias);
        const property = source.getProperty(field.propertyName);
        return `${this.dialect.quoteIdentifier(sourceAlias)}.${this.dialect.quoteIdentifier(property.columnName)}`;
    }
}
