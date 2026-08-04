import type { Migration } from './migration';
import type { MigrationBuilderFactory } from './migration-builder-contract';
import { resolveMigrationBuilderFactory } from './migration-builder-factory';
import {
    createMigrationHistoryTableStatement,
    deleteMigrationHistoryStatement,
    insertMigrationHistoryStatement,
} from './migration-history';
import { migrationStatementsChecksum } from './migration-metadata';
import { selectMigrationRange } from './migration-range';
import {
    renderIdempotentScript,
    renderScript,
} from './migration-script-renderer';
import { postgresMigrationDialect, type MigrationSqlDialect } from './migration-sql-dialect';
import type { SqlStatement } from '../sql/sql-statement';
import { collectMigrationOperation } from './migration-operation-collector';

export { selectMigrationRange } from './migration-range';
export { renderScript } from './migration-script-renderer';

/** Options that configure migration script. */ export interface MigrationScriptOptions {
    /** The from. */ readonly from?: string;
    /** The to. */ readonly to?: string;
    /** The idempotent. */ readonly idempotent?: boolean;
}

/** EntityKit implementation of migration sql generator. */ export class MigrationSqlGenerator {
    /** SQL dialect used for migration history and idempotent blocks. */ public readonly dialect: MigrationSqlDialect;
    private readonly createBuilder: MigrationBuilderFactory;

    constructor(
        dialect: MigrationSqlDialect = postgresMigrationDialect,
        createBuilder?: MigrationBuilderFactory,
    ) {
        this.dialect = dialect;
        this.createBuilder = resolveMigrationBuilderFactory(
            dialect,
            createBuilder,
        );
    }

    /** Perform the build up statements operation. */ public buildUpStatements(migration: Migration): readonly SqlStatement[] {
        const upBuilder = collectMigrationOperation(
            migration,
            'up',
            this.createBuilder,
        );
        const downBuilder = collectMigrationOperation(
            migration,
            'down',
            this.createBuilder,
        );
        return [
            createMigrationHistoryTableStatement(this.dialect),
            ...upBuilder.statements,
            insertMigrationHistoryStatement(
                migration,
                this.dialect,
                migrationStatementsChecksum(
                    upBuilder.statements,
                    downBuilder.statements,
                ),
            ),
        ];
    }

    /** Perform the build down statements operation. */ public buildDownStatements(migration: Migration): readonly SqlStatement[] {
        const builder = collectMigrationOperation(
            migration,
            'down',
            this.createBuilder,
        );
        return [
            ...builder.statements,
            deleteMigrationHistoryStatement(migration, this.dialect),
        ];
    }

    /** Perform the generate up script operation. */ public generateUpScript(migration: Migration): string {
        return renderScript(this.buildUpStatements(migration), this.dialect.sql);
    }

    /** Perform the generate down script operation. */ public generateDownScript(migration: Migration): string {
        return renderScript(this.buildDownStatements(migration), this.dialect.sql);
    }

    /** Perform the generate script operation. */ public generateScript(migrations: readonly Migration[], options: MigrationScriptOptions = {}): string {
        const range = selectMigrationRange(migrations, options.from, options.to);
        if (range.length === 0) {
            return '-- No migrations selected.';
        }

        if (options.idempotent) {
            return renderIdempotentScript(range, this);
        }

        return renderScript([
            createMigrationHistoryTableStatement(this.dialect),
            ...range.flatMap(item => item.direction === 'up'
                ? this.buildUpStatements(item.migration).filter(statement => statement.text !== createMigrationHistoryTableStatement(this.dialect).text)
                : this.buildDownStatements(item.migration)),
        ], this.dialect.sql);
    }
}
