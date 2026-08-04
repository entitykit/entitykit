import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    OutboxMessage,
} from '../../src';
import {
    DbContext,
} from '../../src';
import type { SqlDialect } from '../../src/sql/sql-dialect';
import type { RecordingDatabaseConnection } from '../../src/testing';

export interface DomainEvent {
    type: string;
    payload: Record<string, unknown>;
    aggregateId?: string;
}

export class OutboxUser {
    public id!: string;
    public email!: string;
    public domainEvents: DomainEvent[] = [];
}

export class OutboxContext extends DbContext {
    public users = this.set(OutboxUser);

    constructor(
        private readonly connection: RecordingDatabaseConnection,
        private readonly clearOutboxEvents: (
            entity: object,
            persistedEvents: readonly OutboxMessage[],
        ) => void | Promise<void> = clearPersistedEvents,
        private readonly dialect?: SqlDialect,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options
            .useConnection(this.connection, this.dialect
                ? { provider: this.dialect.name, dialect: this.dialect }
                : {})
            .useOutbox({
                tableName: 'app_outbox',
                now: () => new Date('2026-06-01T12:00:00.000Z'),
                collectEvents: entity =>
                    'domainEvents' in entity ? (entity as OutboxUser).domainEvents : [],
                clearEvents: this.clearOutboxEvents,
            });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(OutboxUser, entity => {
            entity.toTable('outbox_users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.ignore(user => user.domainEvents);
        });
    }

    public static createWith(
        connection: RecordingDatabaseConnection,
        clearEvents?: (
            entity: object,
            persistedEvents: readonly OutboxMessage[],
        ) => void | Promise<void>,
        dialect?: SqlDialect,
    ): OutboxContext {
        return OutboxContext.create(connection, clearEvents, dialect);
    }
}

function clearPersistedEvents(
    entity: object,
    persistedEvents: readonly OutboxMessage[],
): void {
    if ('domainEvents' in entity) {
        const persisted = new Set(persistedEvents);
        const user = entity as OutboxUser;
        user.domainEvents = user.domainEvents.filter(
            event => !persisted.has(event),
        );
    }
}

export function createOutboxUser(
    events: DomainEvent[],
    overrides: Partial<OutboxUser> = {},
): OutboxUser {
    return Object.assign(new OutboxUser(), {
        id: 'usr_1',
        email: 'a@example.com',
        domainEvents: events,
        ...overrides,
    });
}
