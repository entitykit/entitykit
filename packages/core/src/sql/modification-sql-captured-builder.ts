import type { EntityMetadata } from '../model/entity-metadata';
import { DeleteSqlBuilder } from './delete-sql-builder';
import { ModificationSqlOutboxBuilder } from './modification-sql-outbox-builder';
import { postgresDialect, type SqlDialect } from './sql-dialect';
import type { SqlStatement } from './sql-statement';
import { UpdateSqlBuilder } from './update-sql-builder';

/** Owns entity DML built from an executable save snapshot. */
export abstract class ModificationSqlCapturedBuilder extends ModificationSqlOutboxBuilder {
    protected readonly updateBuilder: UpdateSqlBuilder;
    protected readonly deleteBuilder: DeleteSqlBuilder;

    protected constructor(dialect: SqlDialect = postgresDialect) {
        super(dialect);
        this.updateBuilder = new UpdateSqlBuilder(dialect);
        this.deleteBuilder = new DeleteSqlBuilder(dialect);
    }

    public buildInsertFromValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        values: Readonly<Record<string, unknown>>,
        allowMissingProperties: readonly string[] = [],
        boundValues?: Readonly<Record<string, unknown>>,
    ): SqlStatement {
        return this.insertBuilder.buildInsertFromValues(
            metadata, values, allowMissingProperties, boundValues,
        );
    }

    public buildInsertBatchFromValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
        boundRows?: ReadonlyArray<Readonly<Record<string, unknown>>>,
    ): SqlStatement {
        return this.insertBuilder.buildInsertBatchFromValues(
            metadata,
            rows,
            boundRows,
        );
    }

    public buildUpdateFromValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        values: Readonly<Record<string, unknown>>,
        modifiedProperties: readonly string[],
        originalValues: Readonly<Record<string, unknown>> = {},
        boundValues?: Readonly<Record<string, unknown>>,
        originalBoundValues?: Readonly<Record<string, unknown>>,
    ): SqlStatement | undefined {
        return this.updateBuilder.buildUpdateFromValues(
            metadata,
            values,
            modifiedProperties,
            originalValues,
            boundValues,
            originalBoundValues,
        );
    }

    public buildDeleteFromValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        values: Readonly<Record<string, unknown>>,
        originalValues: Readonly<Record<string, unknown>> = {},
        boundValues?: Readonly<Record<string, unknown>>,
        originalBoundValues?: Readonly<Record<string, unknown>>,
    ): SqlStatement {
        return this.deleteBuilder.buildDeleteFromValues(
            metadata,
            values,
            originalValues,
            boundValues,
            originalBoundValues,
        );
    }
}
