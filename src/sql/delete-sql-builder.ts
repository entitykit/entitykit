import type { EntityMetadata } from '../model/entity-metadata';
import type { ManyToManyMetadata } from '../model/many-to-many-metadata';
import type { PredicateNode } from '../query/expression/predicate-node';
import { PredicateSqlCompiler } from './predicate-sql-compiler';
import { SqlParameterBag, type SqlStatement } from './sql-statement';
import { postgresDialect, type SqlDialect } from './sql-dialect';
import {
    buildKeyAndConcurrencyWhere,
    joinEndpointValues,
    requirePostgres,
    type ManyToManyEndpointKey,
} from './modification-sql-helpers';
import { buildKeyAndConcurrencyWhereFromValues } from './captured-value-sql-helpers';

export interface PostgresDeleteSqlOptions {
    readonly predicate: PredicateNode;
}

export interface BulkDeleteSqlOptions {
    readonly predicate: PredicateNode;
}

/**
 * Builds DELETE statements: the entity delete keyed by primary key plus
 * optimistic-concurrency tokens (`buildDelete`), the predicate-driven bulk
 * delete behind `buildBulkDelete`/`buildPostgresDelete`, and many-to-many
 * unlink deletes. Separated from update because a delete carries only a `where`
 * clause — no `set` assignments — so its bound parameters are purely
 * predicate-driven and share nothing with the update assignment order.
 */
export class DeleteSqlBuilder {
    constructor(private readonly dialect: SqlDialect = postgresDialect) {}

    public buildPostgresDelete<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        options: PostgresDeleteSqlOptions,
    ): SqlStatement {
        requirePostgres(this.dialect, 'Postgres delete statements require the postgres SQL dialect.');
        return this.buildWhereDelete(metadata, options, 'Postgres delete statements');
    }

    /** `delete from ... where ...` for a filtered set of rows. Provider-neutral. */
    public buildBulkDelete<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        options: BulkDeleteSqlOptions,
    ): SqlStatement {
        return this.buildWhereDelete(metadata, options, 'executeDelete()');
    }

    private buildWhereDelete<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        options: BulkDeleteSqlOptions,
        label: string,
    ): SqlStatement {
        const candidate: unknown = options;
        if (
            candidate === null ||
            typeof candidate !== 'object' ||
            !('predicate' in candidate) ||
            candidate.predicate === undefined
        ) {
            throw new Error(`${label} require a where predicate.`);
        }

        const parameters = new SqlParameterBag(this.dialect);
        const where = new PredicateSqlCompiler(metadata, parameters, undefined, this.dialect).compile(options.predicate);

        return {
            text: `delete from ${this.dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} where ${where}`,
            values: parameters.values,
        };
    }

    public buildDelete<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entity: TEntity,
        originalValues: Readonly<Record<string, unknown>> = {},
    ): SqlStatement {
        const parameters = new SqlParameterBag(this.dialect);
        const where = buildKeyAndConcurrencyWhere(this.dialect, metadata, entity, originalValues, parameters);

        return {
            text: `delete from ${this.dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} where ${where}`,
            values: parameters.values,
        };
    }

    public buildDeleteFromValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        values: Readonly<Record<string, unknown>>,
        originalValues: Readonly<Record<string, unknown>> = {},
    ): SqlStatement {
        const parameters = new SqlParameterBag(this.dialect);
        const where = buildKeyAndConcurrencyWhereFromValues(
            this.dialect,
            metadata,
            values,
            originalValues,
            parameters,
        );

        return {
            text: `delete from ${this.dialect.quoteQualifiedIdentifier(metadata.schemaName, metadata.tableName)} where ${where}`,
            values: parameters.values,
        };
    }

    public buildDeleteManyToMany<TEntity extends object>(
        relationship: ManyToManyMetadata<TEntity>,
        sourceKeyValues: ManyToManyEndpointKey,
        targetKeyValues: ManyToManyEndpointKey,
    ): SqlStatement {
        return this.buildDeleteManyToManyBatch(relationship, [[sourceKeyValues, targetKeyValues]]);
    }

    public buildDeleteManyToManyBatch<TEntity extends object>(
        relationship: ManyToManyMetadata<TEntity>,
        pairs: ReadonlyArray<readonly [unknown, unknown]>,
    ): SqlStatement {
        if (pairs.length === 0) {
            throw new Error('At least one many-to-many pair is required.');
        }

        const parameters = new SqlParameterBag(this.dialect);
        const columns = [...relationship.sourceForeignKeyColumns, ...relationship.targetForeignKeyColumns];
        const predicates = pairs.map(([sourceKeyValues, targetKeyValues]) => {
            const rowValues = joinEndpointValues(relationship, sourceKeyValues, targetKeyValues);
            const comparisons = columns.map((column, index) =>
                `${this.dialect.quoteIdentifier(column)} = ${parameters.add(rowValues[index])}`);
            // Only group when there is more than one pair to `or` together, so a
            // single-pair delete keeps the SQL it has always produced.
            return pairs.length === 1 ? comparisons.join(' and ') : `(${comparisons.join(' and ')})`;
        });

        return {
            text: `delete from ${this.dialect.quoteQualifiedIdentifier(relationship.joinSchemaName, relationship.joinTableName)} where ${predicates.join(' or ')}`,
            values: parameters.values,
        };
    }
}
