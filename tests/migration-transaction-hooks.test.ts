import { OperationCanceledError, type MigrationDiagnosticEvent } from '../packages/core/src';
import {
    Migration, MigrationRunner, postgresMigrationDialect,
    type MigrationBuilder, type MigrationSqlDialect,
} from '../packages/core/src/migrations/api';
import { RecordingDatabaseConnection } from '../packages/testing/src';
import { anyNumber, containing } from './support/jest-asymmetric-matchers';

class HookMigration extends Migration {
    public readonly id = '20261004000002_ProviderTransaction';
    public readonly name = 'ProviderTransaction';
    public up(builder: MigrationBuilder): void {
        builder.sql('select protected');
    }
    public override down(builder: MigrationBuilder): void {
        builder.sql('select restored');
    }
}

const noLock: MigrationSqlDialect = {
    ...postgresMigrationDialect,
    acquireMigrationLockStatement: undefined,
    releaseMigrationLockStatement: undefined,
};

describe('provider migration transaction hooks', () => {
    it('passes ordered transactional batches, values and options around autonomous statements', async () => {
        const connection = new RecordingDatabaseConnection();
        const signal = new AbortController().signal;
        const batches: string[][] = [];
        const dialect: MigrationSqlDialect = {
            ...noLock,
            async runMigrationTransaction(database, statements, options): Promise<void> {
                expect(this).toBe(dialect);
                expect(database).toBe(connection);
                expect(options).toEqual({ signal });
                batches.push(statements.map(statement => statement.text));
                await database.transaction(async () => {
                    for (const statement of statements) await database.query(statement, options);
                }, options);
            },
        };
        class MixedMigration extends HookMigration {
            public override up(builder: MigrationBuilder): void {
                builder.sql('select left_value', [11]);
                builder.sql('select autonomous', [], { suppressTransaction: true });
                builder.sql('select right_value', [22]);
            }
        }

        await new MigrationRunner(connection, dialect).apply(new MixedMigration(), { signal });

        expect(batches).toEqual([
            [postgresMigrationDialect.createMigrationHistoryTableStatement().text, 'select left_value'],
            ['select right_value', postgresMigrationDialect.insertMigrationHistoryStatement(new MixedMigration(), '').text],
        ]);
        expect(connection.statements.filter(statement => statement.text.startsWith('select '))).toEqual([
            { text: 'select left_value', values: [11] },
            { text: 'select autonomous', values: [] },
            { text: 'select right_value', values: [22] },
        ]);
        expect(connection.transactionEvents).toEqual(['begin', 'commit', 'begin', 'commit']);
    });

    it.each([
        { action: 'apply' as const, phase: 'apply', direction: 'up', statements: 3 },
        { action: 'revert' as const, phase: 'rollback', direction: 'down', statements: 2 },
    ])('preserves cancellation identity and diagnostics for $action', async ({ action, phase, direction, statements }) => {
        const connection = new RecordingDatabaseConnection();
        const reason = new Error('caller canceled migration');
        const canceled = new OperationCanceledError(reason);
        const events: MigrationDiagnosticEvent[] = [];
        const dialect: MigrationSqlDialect = {
            ...noLock,
            async runMigrationTransaction(): Promise<void> {
                return Promise.reject(canceled); 
            },
        };
        const runner = new MigrationRunner(connection, dialect, undefined, {
            diagnostics: [event => {
                events.push(event); 
            }],
        });

        await expect(runner[action](new HookMigration())).rejects.toBe(canceled);

        expect(events).toEqual([containing({
            kind: 'migration', provider: 'postgres', phase, direction,
            migrationId: '20261004000002_ProviderTransaction', migrationName: 'ProviderTransaction',
            statementCount: statements, transactionSuppressedStatements: 0,
            durationMs: anyNumber(), error: canceled,
        })]);
        expect(connection.statements).toEqual([]);
    });

    it.each([
        { action: 'apply' as const, phase: 'apply', direction: 'up', statements: 3 },
        { action: 'revert' as const, phase: 'rollback', direction: 'down', statements: 2 },
    ])('preserves provider failure context and diagnostics for $action', async ({ action, phase, direction, statements }) => {
        const connection = new RecordingDatabaseConnection();
        const failure = new Error('provider transaction failed');
        const events: MigrationDiagnosticEvent[] = [];
        const dialect: MigrationSqlDialect = {
            ...noLock,
            async runMigrationTransaction(): Promise<void> {
                return Promise.reject(failure); 
            },
        };
        const runner = new MigrationRunner(connection, dialect, undefined, { diagnostics: [event => {
            events.push(event); 
        }] });
        const operation = runner[action](new HookMigration());

        await expect(operation).rejects.toMatchObject({
            name: 'MigrationExecutionError', cause: failure,
            details: containing({ phase, direction, statementCount: statements, transactionSuppressedStatements: 0 }),
        });

        expect(events).toEqual([containing({
            kind: 'migration', provider: 'postgres', phase, direction,
            migrationId: '20261004000002_ProviderTransaction', migrationName: 'ProviderTransaction',
            statementCount: statements, transactionSuppressedStatements: 0, durationMs: anyNumber(),
            error: containing({ name: 'MigrationExecutionError', cause: failure }),
        })]);
        expect(connection.statements).toEqual([]);
    });
});
