import type { EntityMetadata } from '../model/entity-metadata';
import type { BinaryOperator, PredicateNode } from '../query/expression/predicate-node';
import { toBoundQueryPropertyValue } from '../query/expression/bound-query-value';
import { likeEscapeClause, sqlBinaryOperator, stringPatternValue } from './select-sql-helpers';
import {
    compileInPredicate,
    isSqlNull,
    readInPredicateValues,
} from './predicate-null-semantics';
import type { SqlParameterBag } from './sql-statement';
import { postgresDialect, type SqlDialect } from './sql-dialect';
import { propertyComparisonParameter } from './property-comparison-parameter';

export class PredicateSqlCompiler<TEntity extends object> {
    constructor(
        private readonly metadata: EntityMetadata<TEntity>,
        private readonly parameters: SqlParameterBag,
        private readonly tableAlias?: string,
        private readonly dialect: SqlDialect = postgresDialect,
    ) {}

    public compile(node: PredicateNode): string {
        switch (node.kind) {
            case 'binary':
                return this.compileBinary(node.propertyName, node.operator, node.value);
            case 'fieldComparison':
                throw new Error('Field-to-field predicates require joined query SQL compilation.');
            case 'null':
                return `${this.column(node.propertyName)} ${node.operator === 'isNull' ? 'is null' : 'is not null'}`;
            case 'logical':
                return `(${this.compile(node.left)} ${node.operator} ${this.compile(node.right)})`;
            case 'not':
                return `(not ${this.compile(node.predicate)})`;
            default:
                return assertNever(node);
        }
    }

    private compileBinary(propertyName: string, operator: BinaryOperator, value: unknown): string {
        const column = this.column(propertyName);

        if ((operator === 'eq' || operator === 'ne') && isSqlNull(value)) {
            return `${column} ${operator === 'eq' ? 'is null' : 'is not null'}`;
        }

        if (operator === 'in') {
            const property = this.metadata.getProperty(propertyName);
            return compileInPredicate(
                column,
                readInPredicateValues(
                    value,
                    `The 'in' operator for '${propertyName}' requires an array value.`,
                ),
                item => propertyComparisonParameter(
                    this.dialect,
                    this.parameters,
                    property,
                    toBoundQueryPropertyValue(
                        item,
                        property,
                        this.metadata.entityName,
                    ),
                ),
                () => this.dialect.falsePredicate(),
            );
        }

        const property = this.metadata.getProperty(propertyName);
        const sqlOperator = sqlBinaryOperator(operator);
        const parameterValue = stringPatternValue(
            operator,
            toBoundQueryPropertyValue(
                value,
                property,
                this.metadata.entityName,
            ),
        );
        const parameter = propertyComparisonParameter(
            this.dialect,
            this.parameters,
            property,
            parameterValue,
        );
        return `${column} ${sqlOperator} ${parameter}${likeEscapeClause(operator)}`;
    }

    private column(propertyName: string): string {
        const columnName = this.dialect.quoteIdentifier(this.metadata.getProperty(propertyName).columnName);
        return this.tableAlias ? `${this.dialect.quoteIdentifier(this.tableAlias)}.${columnName}` : columnName;
    }
}

function assertNever(value: never): never {
    throw new Error(`Unsupported predicate node: ${JSON.stringify(value)}`);
}
