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

    constructor(
        private readonly connection: RecordingDatabaseConnection,
        private readonly collectEvents: (
            entity: object,
        ) => readonly OutboxMessage[] = entity => (entity as ClockAggregate).events,
        private readonly now: () => Date = (async () => {
            await Promise.resolve();
            return new Date('2026-08-04T12:00:00.000Z');
        }) as unknown as () => Date,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
        options.useOutbox({
            collectEvents: this.collectEvents,
            clearEvents: (entity, persisted) => {
                const aggregate = entity as ClockAggregate;
                for (const event of persisted) {
                    const index = aggregate.events.indexOf(event);
                    if (index >= 0) aggregate.events.splice(index, 1);
                }
            },
            now: this.now,
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

    it('rejects an invalid clock before executing statements', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = OutboxClockContext.create(
            connection,
            undefined,
            () => new Date(Number.NaN),
        );
        const aggregate = Object.assign(new ClockAggregate(), { id: 'aggregate_1' });
        aggregate.events.push({ type: 'Created', payload: { id: aggregate.id } });
        db.aggregates.add(aggregate);

        await expect(db.saveChanges()).rejects.toThrow(
            'The outbox clock must return a valid Date.',
        );
        expect(connection.statements).toEqual([]);
        expect(db.entry(aggregate)?.state).toBe(EntityState.Added);
        expect(aggregate.events).toHaveLength(1);
    });

    it.each(['resolve', 'reject'] as const)(
        'rejects a %s promise from the event collector before executing statements',
        async mode => {
            const connection = new RecordingDatabaseConnection();
            const collectEvents = (async (entity: object): Promise<readonly OutboxMessage[]> => {
                await Promise.resolve();
                if (mode === 'reject') throw new Error('collector failed');
                return (entity as ClockAggregate).events;
            }) as unknown as (entity: object) => readonly OutboxMessage[];
            const db = OutboxClockContext.create(
                connection,
                collectEvents,
                () => new Date('2026-08-04T12:00:00.000Z'),
            );
            const aggregate = Object.assign(new ClockAggregate(), { id: `aggregate_${mode}` });
            aggregate.events.push({ type: 'Created', payload: { id: aggregate.id } });
            db.aggregates.add(aggregate);
            const unhandled: unknown[] = [];
            const observeUnhandled = (reason: unknown): void => {
                unhandled.push(reason);
            };
            process.on('unhandledRejection', observeUnhandled);
            try {
                await expect(db.saveChanges()).rejects.toThrow(
                    'The outbox collectEvents callback must be synchronous',
                );
                await new Promise<void>(resolve => setImmediate(resolve));

                expect(connection.statements).toEqual([]);
                expect(db.entry(aggregate)?.state).toBe(EntityState.Added);
                expect(aggregate.events).toHaveLength(1);
                expect(unhandled).toEqual([]);
            } finally {
                process.off('unhandledRejection', observeUnhandled);
            }
        },
    );
});
