import type { EntityMetadata } from '../model/entity-metadata';
import type { PredicateNode } from '../query/expression/predicate-node';
import { toBoundPropertyValue } from '../model/value-converter/store-value';
import { SqlParameterBag, type SqlStatement } from './sql-statement';
import { postgresDialect, type SqlDialect } from './sql-dialect';
import {
    buildKeyAndConcurrencyWhere,
    requirePostgres,
    validateRequiredProperties,
} from './modification-sql-helpers';
import { buildCapturedEntityUpdate } from './captured-update-sql';
import { isGeneratedOnUpdate } from '../model/value-generated';
import { readPropertyValue } from '../model/property-value-access';
import type { MappedUpdateValue } from './mapped-update-values';
import type { EntityUpdateValues } from '../types';
import {
    buildSetWhereUpdate,
    resolveMappedUpdateValues,
} from './set-where-update-sql';

export interface PostgresUpdateSqlOptions<TEntity extends object> {
    readonly values: EntityUpdateValues<TEntity>;
    readonly predicate: PredicateNode;
}

export interface BulkUpdateSqlOptions<TEntity extends object> {
    readonly values: EntityUpdateValues<TEntity>;
    readonly predicate: PredicateNode;
}

export interface ResolvedBulkUpdateSqlOptions {
    readonly assignments: readonly MappedUpdateValue[];
    readonly predicate: PredicateNode;
}

/** Builds entity and predicate-driven UPDATE statements. */
export class UpdateSqlBuilder {
    constructor(private readonly dialect: SqlDialect = postgresDialect) {}

    public buildPostgresUpdate<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        options: PostgresUpdateSqlOptions<TEntity>,
    ): SqlStatement {
        requirePostgres(this.dialect, 'Postgres update statements require the postgres SQL dialect.');
        return buildSetWhereUpdate(
            this.dialect,
            metadata,
            resolveMappedUpdateValues(
                metadata,
                options,
                'Postgres update statements',
            ),
            options.predicate,
            'Postgres update statements',
        );
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
        return buildSetWhereUpdate(
            this.dialect,
            metadata,
            resolveMappedUpdateValues(metadata, options, 'executeUpdate()'),
            options.predicate,
            'executeUpdate()',
        );
    }

    public buildResolvedBulkUpdate<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        options: ResolvedBulkUpdateSqlOptions,
    ): SqlStatement {
        return buildSetWhereUpdate(
            this.dialect,
            metadata,
            options.assignments,
            options.predicate,
            'executeUpdate()',
        );
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
        return buildCapturedEntityUpdate(
            this.dialect,
            metadata,
            values,
            modifiedProperties,
            originalValues,
        );
    }
}
