import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    OutboxMessage,
} from '../src';
import { DbContext, EntityState } from '../src';
import { RecordingDatabaseConnection } from '../src/testing';

class ClockAggregate {
    public id!: string;
    public readonly events: OutboxMessage[] = [];
}

class OutboxClockContext extends DbContext {
    public aggregates = this.set(ClockAggregate);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
        options.useOutbox({
            collectEvents: entity => (entity as ClockAggregate).events,
            clearEvents: (entity, persisted) => {
                const aggregate = entity as ClockAggregate;
                for (const event of persisted) {
                    const index = aggregate.events.indexOf(event);
                    if (index >= 0) aggregate.events.splice(index, 1);
                }
            },
            now: (async () => {
                await Promise.resolve();
                return new Date('2026-08-04T12:00:00.000Z');
            }) as unknown as () => Date,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ClockAggregate, entity => {
            entity.toTable('clock_aggregates');
            entity.hasKey(aggregate => aggregate.id);
            entity.property(aggregate => aggregate.id)
                .hasColumnName('id').hasColumnType('text').isRequired();
            entity.ignore('events');
        });
    }
}

describe('outbox clock synchronous contract', () => {
    it('rejects an asynchronous clock before executing statements', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = OutboxClockContext.create(connection);
        const aggregate = Object.assign(new ClockAggregate(), { id: 'aggregate_1' });
        aggregate.events.push({ type: 'Created', payload: { id: aggregate.id } });
        db.aggregates.add(aggregate);

        await expect(db.saveChanges()).rejects.toThrow(
            'The outbox clock must be synchronous and must not return a Promise.',
        );

        expect(connection.statements).toEqual([]);
        expect(db.entry(aggregate)?.state).toBe(EntityState.Added);
        expect(aggregate.events).toHaveLength(1);
    });
});
