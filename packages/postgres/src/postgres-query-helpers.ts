import type { EntityMetadata } from '@entitykit/core';
import type { PropertySelector } from '@entitykit/core';
import { selectPropertyName } from '@entitykit/core/adapter';
import { createDateBucketGroupKey, type DateBucketGroupKey, type DateBucketPrecision } from '@entitykit/core';
import type { PredicateExpression } from '@entitykit/core';
import { PredicateExpression as PredicateExpressionValue } from '@entitykit/core/experimental';
import type { PredicateNode } from '@entitykit/core/experimental';
import type { QueryField, QueryProxy } from '@entitykit/core';
import { createQueryProxy } from '@entitykit/core/experimental';
import { ModificationSqlBuilder, type PostgresUpsertSqlOptions } from '@entitykit/core/experimental';
import type { SqlStatement } from '@entitykit/core/adapter';
import type { EntityConstructor, EntityUpdateValues } from '@entitykit/core';

/** Options that configure postgres date bucket. */ export interface PostgresDateBucketOptions {
    /** The time zone. */ readonly timeZone: string;
}

/** Options that configure postgres upsert. */ export interface PostgresUpsertOptions<TEntity extends object> {
    /** The conflict. */ readonly conflict?: ReadonlyArray<PropertySelector<TEntity>>;
    /** The update. */ readonly update?: ReadonlyArray<PropertySelector<TEntity>>;
}

/** Options that configure postgres update statement. */ export interface PostgresUpdateStatementOptions<TEntity extends object> {
    /** The set. */ readonly set: EntityUpdateValues<TEntity>;
    /** The where. */ readonly where: (entity: QueryProxy<TEntity>) => PredicateExpression;
}

/** Options that configure postgres delete statement. */ export interface PostgresDeleteStatementOptions<TEntity extends object> {
    /** The where. */ readonly where: (entity: QueryProxy<TEntity>) => PredicateExpression;
}

/** Minimal EntityKit set identity accepted by Postgres statement helpers. */
export interface PostgresEntitySet<TEntity extends object> {
    /** The entity type. */ readonly entityType: EntityConstructor<TEntity>;
}

/** Public contract for postgres query helpers. */ export interface PostgresQueryHelpers {
    /** Perform the date bucket operation. */ dateBucket(
        precision: DateBucketPrecision,
        field: QueryField<Date | null | undefined>,
        options: PostgresDateBucketOptions
    ): DateBucketGroupKey<Date | null>;

    /** Perform the upsert statement operation. */ upsertStatement<TEntity extends object>(
        set: PostgresEntitySet<TEntity>,
        entity: TEntity,
        options?: PostgresUpsertOptions<TEntity>
    ): SqlStatement;

    /** Perform the update statement operation. */ updateStatement<TEntity extends object>(
        set: PostgresEntitySet<TEntity>,
        options: PostgresUpdateStatementOptions<TEntity>
    ): SqlStatement;

    /** Perform the delete statement operation. */ deleteStatement<TEntity extends object>(
        set: PostgresEntitySet<TEntity>,
        options: PostgresDeleteStatementOptions<TEntity>
    ): SqlStatement;
}

/** Built-in postgres. */ export const postgres: PostgresQueryHelpers = Object.freeze({
    /** Perform the date bucket operation. */ dateBucket(
        precision: DateBucketPrecision,
        field: QueryField<Date | null | undefined>,
        options: PostgresDateBucketOptions,
    ): DateBucketGroupKey<Date | null> {
        return createDateBucketGroupKey(precision, field, options);
    },

    /** Perform the upsert statement operation. */ upsertStatement<TEntity extends object>(
        set: PostgresEntitySet<TEntity>,
        entity: TEntity,
        options: PostgresUpsertOptions<TEntity> = {},
    ): SqlStatement {
        return new ModificationSqlBuilder().buildPostgresUpsert(readSetMetadata(set), entity, {
            conflictProperties: selectorsToPropertyNames(options.conflict),
            updateProperties: selectorsToPropertyNames(options.update),
        });
    },

    /** Perform the update statement operation. */ updateStatement<TEntity extends object>(
        set: PostgresEntitySet<TEntity>,
        options: PostgresUpdateStatementOptions<TEntity>,
    ): SqlStatement {
        const candidate: unknown = options;
        if (candidate === null || typeof candidate !== 'object') {
            throw new Error('Postgres update statements must set at least one property.');
        }
        if (typeof options.where !== 'function') {
            throw new Error('Postgres update statements require a where predicate.');
        }
        return new ModificationSqlBuilder().buildPostgresUpdate(readSetMetadata(set), {
            values: options.set,
            predicate: resolveWherePredicate(options.where, 'Postgres update statements require a where predicate.'),
        });
    },

    /** Perform the delete statement operation. */ deleteStatement<TEntity extends object>(
        set: PostgresEntitySet<TEntity>,
        options: PostgresDeleteStatementOptions<TEntity>,
    ): SqlStatement {
        const candidate: unknown = options;
        if (candidate === null || typeof candidate !== 'object') {
            throw new Error('Postgres delete statements require a where predicate.');
        }
        if (typeof options.where !== 'function') {
            throw new Error('Postgres delete statements require a where predicate.');
        }
        return new ModificationSqlBuilder().buildPostgresDelete(readSetMetadata(set), {
            predicate: resolveWherePredicate(options.where, 'Postgres delete statements require a where predicate.'),
        });
    },
});

function readSetMetadata<TEntity extends object>(set: PostgresEntitySet<TEntity>): EntityMetadata<TEntity> {
    const metadata = (set as PostgresEntitySet<TEntity> & {
        readonly metadata?: EntityMetadata<TEntity>;
    }).metadata;
    if (!metadata) {
        throw new TypeError('Postgres statement helpers require an EntityKit DbSet.');
    }
    return metadata;
}

function resolveWherePredicate<TEntity extends object>(
    where: (entity: QueryProxy<TEntity>) => PredicateExpression,
    message: string,
): PredicateNode {
    const expression: unknown = where(createQueryProxy<TEntity>());
    if (!(expression instanceof PredicateExpressionValue)) {
        throw new Error(message);
    }
    return expression.node;
}

function selectorsToPropertyNames<TEntity extends object>(
    selectors: ReadonlyArray<PropertySelector<TEntity>> | undefined,
): PostgresUpsertSqlOptions<TEntity>['conflictProperties'] | undefined {
    return selectors?.map(selector => selectPropertyName(selector));
}
