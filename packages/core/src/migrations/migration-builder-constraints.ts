import type { SqlDialect } from '../sql/sql-dialect';
import * as ConstraintOps from './migration-builder-constraint-ops';
import * as IndexOps from './migration-builder-index-ops';
import { MigrationBuilderTableSurface } from './migration-builder-table-surface';
import type {
    MigrationBuilderOptions,
    MigrationDropIndexOptions,
    MigrationForeignKeyDefinition,
    MigrationIndexDefinition,
} from './migration-builder-types';

/**
 * Owns the constraint and index part of `MigrationBuilder`'s fluent surface.
 */
export abstract class MigrationBuilderConstraints extends MigrationBuilderTableSurface {
    protected constructor(
        dialect?: SqlDialect,
        options: MigrationBuilderOptions = {},
    ) {
        super(dialect, options);
    }

    /** Whether this provider can add or drop table constraints with `alter table`. */
    public get canAlterTableConstraints(): boolean {
        return this.core.supportsAlterTableConstraints;
    }

    public addPrimaryKey(tableName: string, constraintName: string, columns: readonly string[], schemaName?: string): this {
        ConstraintOps.addPrimaryKey(this.core, tableName, constraintName, columns, schemaName);
        return this;
    }

    public dropPrimaryKey(tableName: string, constraintName: string, schemaName?: string): this {
        ConstraintOps.dropPrimaryKey(this.core, tableName, constraintName, schemaName);
        return this;
    }

    public addUniqueConstraint(tableName: string, constraintName: string, columns: readonly string[], schemaName?: string): this {
        ConstraintOps.addUniqueConstraint(this.core, tableName, constraintName, columns, schemaName);
        return this;
    }

    public dropUniqueConstraint(tableName: string, constraintName: string, schemaName?: string): this {
        ConstraintOps.dropUniqueConstraint(this.core, tableName, constraintName, schemaName);
        return this;
    }

    public createIndex(index: MigrationIndexDefinition): this {
        IndexOps.createIndex(this.core, index);
        return this;
    }

    public dropIndex(indexName: string, schemaName?: string, options: MigrationDropIndexOptions = {}): this {
        IndexOps.dropIndex(this.core, indexName, schemaName, options);
        return this;
    }

    public renameIndex(indexName: string, newIndexName: string, schemaName?: string): this {
        IndexOps.renameIndex(this.core, indexName, newIndexName, schemaName);
        return this;
    }

    public addForeignKey(foreignKey: MigrationForeignKeyDefinition): this {
        ConstraintOps.addForeignKey(this.core, foreignKey);
        return this;
    }

    public dropForeignKey(tableName: string, constraintName: string, schemaName?: string): this {
        ConstraintOps.dropForeignKey(this.core, tableName, constraintName, schemaName);
        return this;
    }

    public addCheckConstraint(
        tableName: string,
        constraintName: string,
        sql: string,
        schemaName?: string,
    ): this {
        ConstraintOps.addCheckConstraint(
            this.core,
            tableName,
            constraintName,
            sql,
            schemaName,
        );
        return this;
    }

    public dropCheckConstraint(
        tableName: string,
        constraintName: string,
        schemaName?: string,
    ): this {
        ConstraintOps.dropCheckConstraint(
            this.core,
            tableName,
            constraintName,
            schemaName,
        );
        return this;
    }
}
