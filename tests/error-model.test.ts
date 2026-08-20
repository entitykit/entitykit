import type {
    DbContextOptionsBuilder,
    ModelBuilder } from '../packages/core/src';
import {
    DbContext,
    DbUpdateConcurrencyError,
    EntityKitError,
    EntityNotFoundError,
    EntityState,
    MultipleEntitiesFoundError,
    OperationCanceledError,
    QueryCompilationError,
    UniqueConstraintError,
    isEntityKitError,
} from '../packages/core/src';
import {
    MigrationChecksumError,
    MigrationDataLossError,
    MigrationExecutionError,
} from '../packages/core/src/migrations/api';
import { RecordingDatabaseConnection } from '../packages/testing/src';

class ErrorUser {
    public id!: string;
    public email!: string;
}

let activeConnection: RecordingDatabaseConnection;

class ErrorContext extends DbContext {
    public users = this.set(ErrorUser);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(activeConnection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ErrorUser, entity => {
            entity.toTable('error_users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
        });
    }
}

describe('EntityKit error model', () => {
    it('uses typed query errors for single result failures', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [], rowCount: 0 });
        activeConnection = connection;
        const db =  ErrorContext.create();

        await expect(db.users.single()).rejects.toBeInstanceOf(EntityNotFoundError);

        connection.queueResult({
            rows: [
                { id: 'usr_1', email: 'a@example.com' },
                { id: 'usr_2', email: 'b@example.com' },
            ],
            rowCount: 2,
        });

        await expect(db.users.single()).rejects.toBeInstanceOf(MultipleEntitiesFoundError);
    });

    it('uses a typed query-compilation error for invalid query shapes', () => {
        activeConnection = new RecordingDatabaseConnection();
        const db = ErrorContext.create();

        expect(() => db.users.where(() => null as never)).toThrow(QueryCompilationError);
        try {
            db.users.take(-1);
        } catch (error) {
            expect(error).toMatchObject({ code: 'QUERY_COMPILATION' });
        }
    });

    it('keeps concurrency conflicts under the base EntityKit error type', () => {
        const error = new DbUpdateConcurrencyError('User', 'usr_1', EntityState.Modified, 0);

        expect(error).toBeInstanceOf(EntityKitError);
        expect(error.code).toBe('DB_CONCURRENCY_CONFLICT');
        expect(error.details).toMatchObject({ entityName: 'User', keyValue: 'usr_1' });
    });

    it('publishes unique, versioned codes as a machine-readable protocol', () => {
        const error = new UniqueConstraintError('users_email_key');

        expect(isEntityKitError(error)).toBe(true);
        expect(isEntityKitError(new Error('not EntityKit'))).toBe(false);
        expect(error.toJSON()).toEqual({
            schemaVersion: 1,
            name: 'UniqueConstraintError',
            code: 'DB_UNIQUE_CONSTRAINT',
            message: 'Unique constraint violation on \'users_email_key\'.',
            details: { constraint: 'users_email_key' },
        });
    });

    it('uses a stable cancellation error without serializing the signal reason', () => {
        const reason = new Error('request disconnected');
        const error = new OperationCanceledError(reason);

        expect(isEntityKitError(error)).toBe(true);
        expect(error.cause).toBe(reason);
        expect(error.toJSON()).toEqual({
            schemaVersion: 1,
            name: 'OperationCanceledError',
            code: 'OPERATION_CANCELED',
            message: 'The database operation was canceled.',
            details: undefined,
        });
    });

    it('keeps serialized error details JSON-safe and redacts nested errors', () => {
        const circular: Record<string, unknown> = { count: 42n };
        circular.self = circular;
        circular.cause = new Error('secret provider message');
        const error = new EntityKitError('failed', {
            code: 'DB_UPDATE_ERROR',
            details: circular,
        });

        expect(() => JSON.stringify(error)).not.toThrow();
        expect(error.toJSON().details).toEqual({
            count: '42n',
            self: '[Circular]',
            cause: { name: 'Error' },
        });
    });

    it('never invokes detail accessors or throws for hostile diagnostic values', () => {
        const shared = { value: 1 };
        const details = {
            get secret(): string {
                throw new Error('must not run');
            },
            first: shared,
            second: shared,
            hostile: new Proxy({}, {
                ownKeys: () => {
                    throw new Error('cannot inspect');
                },
            }),
        };
        const error = new EntityKitError('failed', {
            code: 'DB_UPDATE_ERROR',
            details,
        });

        expect(() => JSON.stringify(error)).not.toThrow();
        expect(error.toJSON().details).toEqual({
            secret: '[Accessor]',
            first: { value: 1 },
            second: { value: 1 },
            hostile: '[Unserializable]',
        });
        expect(isEntityKitError(new Proxy({}, {
            get: () => {
                throw new Error('cannot inspect');
            },
        }))).toBe(false);
    });

    it('exposes migration safety errors', () => {
        expect(new MigrationChecksumError('20260601000000_Test').code)
            .toBe('MIGRATION_CHECKSUM_MISMATCH');
        expect(new MigrationDataLossError(['drop column users.name']))
            .toMatchObject({
                code: 'MIGRATION_DATA_LOSS',
                details: { warnings: ['drop column users.name'] },
            });
        expect(new MigrationExecutionError({
            migrationId: '20260601000000_Test',
            migrationName: 'Test',
            phase: 'apply',
            direction: 'up',
            statementCount: 2,
            transactionSuppressedStatements: 0,
            cause: new Error('failed'),
        }).code).toBe('MIGRATION_EXECUTION');
    });
});
