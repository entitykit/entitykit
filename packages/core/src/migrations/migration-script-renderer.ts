import type { Migration } from './migration';
import { createMigrationHistoryTableStatement } from './migration-history';
import type { MigrationRangeItem } from './migration-range';
import type { MigrationSqlDialect } from './migration-sql-dialect';
import { postgresDialect, type SqlDialect } from '../sql/sql-dialect';
import type { SqlStatement } from '../sql/sql-statement';
import { inlineScriptParameters } from './migration-script-parameters';

interface MigrationStatementSource {
    readonly dialect: MigrationSqlDialect;
    buildUpStatements(migration: Migration): readonly SqlStatement[];
}

/** Render script. */ export function renderScript(
    statements: readonly SqlStatement[],
    dialect: SqlDialect = postgresDialect,
): string {
    return statements
        .map(statement => {
            const sql = inlineScriptParameters(statement, dialect)
                .trim()
                .replace(/;$/, '') + ';';
            return statement.suppressTransaction
                ? `-- EntityKit: runs outside the migration transaction by request.\n${sql}`
                : sql;
        })
        .join('\n\n');
}

export function renderIdempotentScript(
    range: readonly MigrationRangeItem[],
    generator: MigrationStatementSource,
): string {
    const dialect = generator.dialect;
    if (!dialect.renderIdempotentMigrationBlock) {
        throw new Error(
            `Idempotent scripts are not supported by migration dialect '${dialect.name}'.`,
        );
    }

    const sections = [
        renderScript(
            [createMigrationHistoryTableStatement(dialect)],
            dialect.sql,
        ),
    ];

    for (const item of range) {
        if (item.direction === 'down') {
            throw new Error('Idempotent rollback scripts are not supported.');
        }

        const statements = generator
            .buildUpStatements(item.migration)
            .filter(
                statement =>
                    statement.text !==
          createMigrationHistoryTableStatement(dialect).text,
            );
        if (hasTransactionSuppressedStatement(statements)) {
            throw new Error(
                'Idempotent scripts cannot include transaction-suppressed statements.',
            );
        }

        sections.push(
            dialect.renderIdempotentMigrationBlock(
                item.migration,
                renderScript(statements, dialect.sql),
            ),
        );
    }

    return sections.join('\n\n');
}

function hasTransactionSuppressedStatement(
    statements: readonly SqlStatement[],
): boolean {
    return statements.some(statement =>
        Boolean(statement.suppressTransaction),
    );
}
