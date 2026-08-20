import type {
    DbContextOptionsBuilder,
    ModelBuilder } from '../../packages/core/src';
import {
    DbContext,
    type RuntimeDiagnosticEvent,
} from '../../packages/core/src';
import { RecordingDatabaseConnection } from './recording-database-connection';

export class User {
    public id!: string;
    public email!: string;
    public name!: string;
    public version!: number;
    public updatedAt!: Date;

    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
}

export class ConcurrencyContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public static events: RuntimeDiagnosticEvent[] = [];

    public users = this.set(User);

    protected override configure(options: DbContextOptionsBuilder): void {
        options
            .useConnection(ConcurrencyContext.connection)
            .useDiagnostics(
                event => {
                    ConcurrencyContext.events.push(event);
                },
                { includeSensitiveData: true },
            );
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(user => user.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(user => user.version).hasColumnName('version').hasColumnType('integer').isRequired().isVersion();
            entity.property(user => user.updatedAt).hasColumnName('updated_at').hasColumnType('timestamptz').isRequired().isConcurrencyToken();
        });
    }
}

export function createConcurrencyContext(
    connection = new RecordingDatabaseConnection(),
): ConcurrencyContext {
    ConcurrencyContext.connection = connection;
    ConcurrencyContext.events = [];
    return ConcurrencyContext.create();
}

export function createConcurrencyUser(
    overrides: Partial<User> = {},
): User {
    return new User({
        id: 'usr_1',
        email: 'a@example.com',
        name: 'A',
        version: 1,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...overrides,
    });
}
