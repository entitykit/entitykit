import type { EntityMetadata } from '../../model/entity-metadata';
import {
    toBoundPropertyValue,
} from '../../model/value-converter/store-value';
import type {
    GroupKeyExpression,
    GroupKeyProjectionExpression,
    HavingOperandExpression,
} from '../../query/aggregate';
import { metadataForSource, normalizeSourceAlias } from '../select-sql-helpers';
import type { SqlDialect } from '../sql-dialect';

export class AggregateExpressionRenderer {
    constructor(private readonly dialect: SqlDialect) {}

    public aggregateFunctionSql(func: string, columnSql: string): string {
        if (func === 'avg') {
            return `avg(${this.dialect.avgOperand?.(columnSql) ?? columnSql})`;
        }
        return `${func}(${columnSql})`;
    }

    public havingOperandSql<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        operand: HavingOperandExpression,
        sourceMetadata?: ReadonlyMap<string, EntityMetadata>,
    ): string {
        if (operand.kind === 'groupKey') {
            return this.groupKeySql(metadata, {
                kind: operand.expressionKind,
                alias: operand.keyAlias,
                provider: operand.provider,
                precision: operand.precision,
                timeZone: operand.timeZone,
                sourceAlias: operand.sourceAlias,
                propertyName: operand.propertyName,
            } as GroupKeyExpression, sourceMetadata);
        }

        return operand.propertyName
            ? this.aggregateFunctionSql(
                operand.function,
                this.aggregateColumnSql(
                    metadata, operand.sourceAlias, operand.propertyName, sourceMetadata,
                ),
            )
            : this.dialect.countAllExpression();
    }

    public havingProviderValue<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        operand: HavingOperandExpression,
        value: unknown,
        sourceMetadata?: ReadonlyMap<string, EntityMetadata>,
    ): unknown {
        if (operand.kind === 'groupKey') {
            if (operand.expressionKind === 'dateBucket') {
                return value;
            }

            const source = this.metadataForSource(
                metadata, operand.sourceAlias, sourceMetadata,
            );
            const property = source.getProperty(operand.propertyName);
            return toBoundPropertyValue(value, property, source.entityName);
        }

        if (operand.function === 'min' || operand.function === 'max') {
            const source = this.metadataForSource(
                metadata, operand.sourceAlias, sourceMetadata,
            );
            const property = source.getProperty(operand.propertyName as never);
            return toBoundPropertyValue(value, property, source.entityName);
        }

        return value;
    }

    public groupKeySql<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        groupKey: GroupKeyExpression | GroupKeyProjectionExpression,
        sourceMetadata?: ReadonlyMap<string, EntityMetadata>,
    ): string {
        if (groupKey.kind === 'property') {
            return this.aggregateColumnSql(
                metadata, groupKey.sourceAlias, groupKey.propertyName, sourceMetadata,
            );
        }
        if (this.dialect.name !== 'postgres') {
            throw new Error('Postgres date bucket group keys require the postgres SQL dialect.');
        }

        const column = this.aggregateColumnSql(
            metadata, groupKey.sourceAlias, groupKey.propertyName, sourceMetadata,
        );
        return `date_trunc(${postgresLiteral(groupKey.precision)}, timezone(${postgresLiteral(groupKey.timeZone)}, ${column}))`;
    }

    public aggregateColumnSql<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        sourceAlias: string | undefined,
        propertyName: string,
        sourceMetadata?: ReadonlyMap<string, EntityMetadata>,
    ): string {
        const source = this.metadataForSource(metadata, sourceAlias, sourceMetadata);
        const property = source.getProperty(propertyName);
        if (!sourceMetadata) {
            return this.dialect.quoteIdentifier(property.columnName);
        }
        return `${this.dialect.quoteIdentifier(normalizeSourceAlias(sourceAlias))}.${this.dialect.quoteIdentifier(property.columnName)}`;
    }

    private metadataForSource<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        sourceAlias: string | undefined,
        sourceMetadata?: ReadonlyMap<string, EntityMetadata>,
    ): EntityMetadata {
        return sourceMetadata
            ? metadataForSource(sourceMetadata, normalizeSourceAlias(sourceAlias))
            : metadata as unknown as EntityMetadata;
    }
}

function postgresLiteral(value: string): string {
    return `'${value.replace(/'/g, '\'\'')}'`;
}
