import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    OutboxMessage,
} from '../packages/core/src';
import { DbContext } from '../packages/core/src';

class BigIntAggregate {
    public id!: bigint;
    public events: OutboxMessage[] = [];
}

class BigIntOutboxContext extends DbContext {
    public aggregates = this.set(BigIntAggregate);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useSqlite(':memory:').useOutbox({
            tableName: 'app_outbox',
            collectEvents: entity => entity instanceof BigIntAggregate
                ? entity.events
                : [],
            clearEvents: (entity, events): void => {
                if (entity instanceof BigIntAggregate) {
                    const persisted = new Set(events);
                    entity.events = entity.events.filter(event =>
                        !persisted.has(event));
                }
            },
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(BigIntAggregate, entity => {
            entity.toTable('bigint_aggregates');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('bigint').isRequired();
            entity.ignore(item => item.events);
        });
    }
}

describe('outbox aggregate identity against SQLite', () => {
    it('persists an automatic bigint key without routing it through JSON', async () => {
        const db = BigIntOutboxContext.create();
        try {
            await db.database.connection.query({
                text: 'create table app_outbox (type text, payload text, aggregate_id text, occurred_at text)',
                values: [],
            });
            const aggregate = Object.assign(new BigIntAggregate(), {
                id: 9007199254740993n,
                events: [{ type: 'Created', payload: { ok: true } }],
            });
            db.aggregates.attach(aggregate);

            await expect(db.saveChanges()).resolves.toBe(0);
            const result = await db.database.connection.query<{
                aggregate_id: string;
                payload: string;
            }>({
                text: 'select aggregate_id, payload from app_outbox',
                values: [],
            });
            expect(result.rows).toEqual([{
                aggregate_id: '9007199254740993',
                payload: '{"ok":true}',
            }]);
            expect(aggregate.events).toEqual([]);
        } finally {
            await db.dispose();
        }
    });
});
