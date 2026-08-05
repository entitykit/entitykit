import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    OutboxMessage,
} from '../src';
import { DbContext, valueConverter } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

interface EventSource {
    events: OutboxMessage[];
}

class BigIntAggregate implements EventSource {
    public id!: bigint;
    public events: OutboxMessage[] = [];
}

class DateAggregate implements EventSource {
    public id!: Date;
    public events: OutboxMessage[] = [];
}

interface ConvertedKey {
    readonly raw: string;
}

class ConvertedAggregate implements EventSource {
    public id!: ConvertedKey;
    public events: OutboxMessage[] = [];
}

class BinaryAggregate implements EventSource {
    public id!: Uint8Array;
    public events: OutboxMessage[] = [];
}

class CompositeAggregate implements EventSource {
    public tenantId!: string;
    public sequence!: bigint;
    public events: OutboxMessage[] = [];
}

const convertedKey = valueConverter<ConvertedKey, string>({
    toProvider: value => value.raw,
    fromProvider: value => ({ raw: value }),
});

class AggregateIdContext extends DbContext {
    public bigInts = this.set(BigIntAggregate);
    public dates = this.set(DateAggregate);
    public converted = this.set(ConvertedAggregate);
    public binaries = this.set(BinaryAggregate);
    public composites = this.set(CompositeAggregate);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection).useOutbox({
            tableName: 'app_outbox',
            collectEvents: entity => 'events' in entity
                ? (entity as EventSource).events
                : [],
            clearEvents: (): void => undefined,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(BigIntAggregate, entity => {
            entity.toTable('bigint_aggregates');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('bigint').isRequired();
            entity.ignore(item => item.events);
        });
        model.entity(DateAggregate, entity => {
            entity.toTable('date_aggregates');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('timestamp').isRequired();
            entity.ignore(item => item.events);
        });
        model.entity(ConvertedAggregate, entity => {
            entity.toTable('converted_aggregates');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('text').isRequired()
                .hasConversion(convertedKey);
            entity.ignore(item => item.events);
        });
        model.entity(BinaryAggregate, entity => {
            entity.toTable('binary_aggregates');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('blob').isRequired();
            entity.ignore(item => item.events);
        });
        model.entity(CompositeAggregate, entity => {
            entity.toTable('composite_aggregates');
            entity.hasKey(item => [item.tenantId, item.sequence]);
            entity.property(item => item.tenantId).hasColumnType('text').isRequired();
            entity.property(item => item.sequence).hasColumnType('bigint').isRequired();
            entity.ignore(item => item.events);
        });
    }
}

function event(aggregateId?: unknown): OutboxMessage {
    return {
        type: 'Created',
        payload: { ok: true },
        ...aggregateId === undefined ? {} : { aggregateId },
    };
}

function capturedAggregateId(
    attach: (db: AggregateIdContext) => void,
): unknown {
    const db = AggregateIdContext.create(new RecordingDatabaseConnection());
    attach(db);
    return db.getSavePlan()[0]?.statement.values[2];
}

describe('outbox aggregate identity formatting', () => {
    it('formats every supported mapped key domain without JSON coercion', () => {
        expect(capturedAggregateId(db => db.bigInts.attach(Object.assign(
            new BigIntAggregate(), { id: 9007199254740993n, events: [event()] },
        )))).toBe('9007199254740993');
        expect(capturedAggregateId(db => db.dates.attach(Object.assign(
            new DateAggregate(), {
                id: new Date('2026-08-04T12:34:56.789Z'), events: [event()],
            },
        )))).toBe('2026-08-04T12:34:56.789Z');
        expect(capturedAggregateId(db => db.converted.attach(Object.assign(
            new ConvertedAggregate(), {
                id: { raw: 'converted_7' }, events: [event()],
            },
        )))).toBe('converted_7');
        expect(capturedAggregateId(db => db.binaries.attach(Object.assign(
            new BinaryAggregate(), {
                id: new Uint8Array([0, 15, 255]), events: [event()],
            },
        )))).toBe('0x000fff');
        expect(capturedAggregateId(db => db.composites.attach(Object.assign(
            new CompositeAggregate(), {
                tenantId: 'acme', sequence: 9007199254740993n, events: [event()],
            },
        )))).toBe(
            '["entitykit:composite:v1",["string","acme"],["bigint","9007199254740993"]]',
        );
    });

    it.each([
        [9007199254740993n, '9007199254740993'],
        [new Date('2026-08-04T12:34:56.789Z'), '2026-08-04T12:34:56.789Z'],
        [new Uint8Array([0, 15, 255]), '0x000fff'],
    ])('formats an explicit %p aggregate identity', (aggregateId, expected) => {
        expect(capturedAggregateId(db => db.bigInts.attach(Object.assign(
            new BigIntAggregate(), {
                id: 1n, events: [event(aggregateId)],
            },
        )))).toBe(expected);
    });
});
