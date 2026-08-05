import type { EntityMetadata } from '../model/entity-metadata';
import type { PredicateNode } from '../query/expression/predicate-node';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import { PredicateSqlCompiler } from './predicate-sql-compiler';
import { SqlParameterBag, type SqlStatement } from './sql-statement';
import { postgresDialect, type SqlDialect } from './sql-dialect';
import {
    buildKeyAndConcurrencyWhere,
    buildKeyAndConcurrencyWhereFromValues,
    requirePostgres,
    validateRequiredProperties,
    validateRequiredPropertyValues,
} from './modification-sql-helpers';
import { isGeneratedOnUpdate } from '../model/value-generated';
import { readPropertyValue } from '../model/property-value-access';
import { mappedUpdateValues } from './mapped-update-values';
import type { EntityUpdateValues } from '../types';

export interface PostgresUpdateSqlOptions<TEntity extends object> {
    readonly values: EntityUpdateValues<TEntity>;
    readonly predicate: PredicateNode;
}

export interface BulkUpdateSqlOptions<TEntity extends object> {
    readonly values: EntityUpdateValues<TEntity>;
    readonly predicate: PredicateNode;
}

/**
 * Builds UPDATE statements in the ORM's two update shapes: the entity update
 * keyed by primary key plus optimistic-concurrency tokens (`buildUpdate`), and
 * the predicate-driven `set ... where` update behind both `buildBulkUpdate` and
 * `buildPostgresUpdate`. Kept apart from insert and delete because only updates
 * bind assignment values *before* the `where` predicate, so that ordering lives
 * in one place and cannot drift against the other verbs.
 */
export class UpdateSqlBuilder {
    constructor(private readonly dialect: SqlDialect = postgresDialect) {}

    public buildPostgresUpdate<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        options: PostgresUpdateSqlOptions<TEntity>,
    ): SqlStatement {
        requirePostgres(this.dialect, 'Postgres update statements require the postgres SQL dialect.');
        return this.buildSetWhereUpdate(metadata, options, 'Postgres update statements');
    }

    /**
   * `update ... set ... where ...` for a filtered set of rows.
   *
   * Provider-neutral: identifier quoting, parameter placeholders, and predicate
   * compilation all come from the configured dialect.
   */
    public buildBulkUpdate<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        options: BulkUpdateSqlOptions<TEntity>,
    ): SqlStatement {
        return this.buildSetWhereUpdate(metadata, options, 'executeUpdate()');
    }

    private buildSetWhereUpdate<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        options: BulkUpdateSqlOptions<TEntity>,
        label: string,
    ): SqlStatement {
        const candidate: unknown = options;
        if (
            candidate === null ||
            typeof candidate !== 'object' ||
            !('values' in candidate) ||
            candidate.values === undefined
        ) {
            throw new Error(`${label} must set at least one property.`);
        }
        const entries = mappedUpdateValues(metadata, options.values);
        if (entries.length === 0) {
            throw new Error(`${label} must set at least one property.`);
        }
        if (!('predicate' in candidate) || candidate.predicate === undefined) {
            throw new Error(`${label} require a where predicate.`);
        }

        const parameters = new SqlParameterBag(this.dialect);
        const assignments = entries.map(({ property, value }) => {
            if (property.isPrimaryKey) {
                throw new Error(`${label} cannot update primary key property '${metadata.entityName}.${property.propertyName}'.`);
            }

            return `${this.dialect.quoteIdentifier(property.columnName)} = ${parameters.add(toBoundPropertyValue(value, property, metadata.entityName))}`;
        });
        const where = new PredicateSqlCompiler(metadata, parameters, undefined, this.dialect).compile(options.predicate);

        return {
            text: `update ${this.dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} set ${assignments.join(', ')} where ${where}`,
            values: parameters.values,
        };
    }

    public buildUpdate<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entity: TEntity,
        modifiedProperties: readonly string[],
        originalValues: Readonly<Record<string, unknown>> = {},
    ): SqlStatement | undefined {
        validateRequiredProperties(metadata, entity);

        const versionProperties = metadata.properties.filter(property => property.isVersion);
        const keyProperties: Set<string> = new Set(metadata.keyProperties);
        const writableProperties = modifiedProperties
            .filter(propertyName => !keyProperties.has(propertyName))
            .map(propertyName => metadata.getProperty(propertyName as never))
            .filter(property =>
                !property.isVersion &&
                !isGeneratedOnUpdate(property.valueGenerated),
            );

        if (writableProperties.length === 0 && versionProperties.length === 0) {
            return undefined;
        }

        const parameters = new SqlParameterBag(this.dialect);
        const assignments = [
            ...writableProperties.map(property => `${this.dialect.quoteIdentifier(property.columnName)} = ${parameters.add(toBoundPropertyValue(readPropertyValue(entity, property), property, metadata.entityName))}`),
            ...versionProperties.map(property => `${this.dialect.quoteIdentifier(property.columnName)} = ${this.dialect.quoteIdentifier(property.columnName)} + 1`),
        ].join(', ');
        const where = buildKeyAndConcurrencyWhere(this.dialect, metadata, entity, originalValues, parameters);

        const generatedProperties = metadata.properties.filter(
            property => isGeneratedOnUpdate(property.valueGenerated),
        );
        const returning = generatedProperties.length > 0
            ? this.dialect.returningClause?.(
                generatedProperties.map(property => property.columnName),
            )
            : undefined;

        return {
            text: `update ${this.dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} set ${assignments} where ${where}${returning ? ` ${returning}` : ''}`,
            values: parameters.values,
        };
    }

    public buildUpdateFromValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        values: Readonly<Record<string, unknown>>,
        modifiedProperties: readonly string[],
        originalValues: Readonly<Record<string, unknown>> = {},
    ): SqlStatement | undefined {
        validateRequiredPropertyValues(metadata, values);

        const versionProperties = metadata.properties.filter(property =>
            property.isVersion);
        const keyProperties: Set<string> = new Set(metadata.keyProperties);
        const writableProperties = modifiedProperties
            .filter(propertyName => !keyProperties.has(propertyName))
            .map(propertyName => metadata.getProperty(propertyName as never))
            .filter(property =>
                !property.isVersion &&
                !isGeneratedOnUpdate(property.valueGenerated),
            );

        if (writableProperties.length === 0 && versionProperties.length === 0) {
            return undefined;
        }

        const parameters = new SqlParameterBag(this.dialect);
        const assignments = [
            ...writableProperties.map(property =>
                `${this.dialect.quoteIdentifier(property.columnName)} = ${parameters.add(toBoundPropertyValue(values[property.propertyName], property, metadata.entityName))}`),
            ...versionProperties.map(property =>
                `${this.dialect.quoteIdentifier(property.columnName)} = ${this.dialect.quoteIdentifier(property.columnName)} + 1`),
        ].join(', ');
        const where = buildKeyAndConcurrencyWhereFromValues(
            this.dialect,
            metadata,
            values,
            originalValues,
            parameters,
        );

        const generatedProperties = metadata.properties.filter(property =>
            isGeneratedOnUpdate(property.valueGenerated));
        const returning = generatedProperties.length > 0
            ? this.dialect.returningClause?.(
                generatedProperties.map(property => property.columnName),
            )
            : undefined;

        return {
            text: `update ${this.dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} set ${assignments} where ${where}${returning ? ` ${returning}` : ''}`,
            values: parameters.values,
        };
    }
}
