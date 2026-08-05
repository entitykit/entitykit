import type { DbContextOptionsBuilder, JsonValue, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

interface DomainEvent {
    readonly type: string;
    readonly payload: JsonValue;
}

class GeneratedAggregate {
    public id!: number;
    public name!: string;
    public events: DomainEvent[] = [];
}

class GeneratedOutboxContext extends DbContext {
    public aggregates = this.set(GeneratedAggregate);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options
            .useConnection(this.connection, {
                provider: postgresDialect.name,
                dialect: postgresDialect,
            })
            .useOutbox({
                tableName: 'app_outbox',
                collectEvents: entity =>
                    entity instanceof GeneratedAggregate ? entity.events : [],
                clearEvents: (entity, events) => {
                    if (entity instanceof GeneratedAggregate) {
                        const persisted = new Set(events);
                        entity.events = entity.events.filter(event =>
                            !persisted.has(event));
                    }
                },
            });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedAggregate, entity => {
            entity.toTable('generated_aggregates');
            entity.hasKey(aggregate => aggregate.id);
            entity.property(aggregate => aggregate.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
            entity.property(aggregate => aggregate.name).hasColumnType('text').isRequired();
            entity.ignore(aggregate => aggregate.events);
        });
    }
}

describe('generated outbox aggregate identities', () => {
    it('builds the outbox statement after generated key hydration', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = GeneratedOutboxContext.create(connection);
        const aggregate = Object.assign(new GeneratedAggregate(), {
            name: 'generated',
            events: [{ type: 'Created', payload: { source: 'test' } }],
        });
        db.aggregates.add(aggregate);
        connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(connection.statements[1]?.values).toEqual([
            'Created',
            '{"source":"test"}',
            41,
            expect.any(Date),
        ]);
        expect(aggregate.events).toEqual([]);
    });

    it('uses persisted identity and captured payload after live mutations', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = GeneratedOutboxContext.create(connection);
        const payload = { source: 'captured' };
        const target = Object.assign(new GeneratedAggregate(), {
            name: 'generated',
            events: [{ type: 'Created', payload }],
        });
        const aggregate = new Proxy(target, {
            set: (entity, property, value) => {
                const written = Reflect.set(entity, property, value);
                if (property === 'id' && value === 41) {
                    queueMicrotask(() => {
                        entity.id = 999;
                        payload.source = 'later';
                    });
                }
                return written;
            },
        });
        db.aggregates.add(aggregate);
        connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await db.saveChanges();

        expect(connection.statements[1]?.values).toEqual([
            'Created',
            '{"source":"captured"}',
            41,
            expect.any(Date),
        ]);
        expect(db.entry(aggregate)?.originalValues.id).toBe(41);
        expect(db.entry(aggregate)?.state).toBe(EntityState.Modified);
    });
});
