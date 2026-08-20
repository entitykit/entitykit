import type { EntityMaterializer } from '../packages/core/src';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import { Materializer } from '../packages/core/src/experimental';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';

type FactoryMode = 'sync' | 'resolve' | 'reject' | 'thenable';

let mode: FactoryMode;

class FactoryRecord {
    public id!: string;
}

async function createLater(id: string): Promise<FactoryRecord> {
    await Promise.resolve();
    return Object.assign(new FactoryRecord(), { id });
}

async function rejectLater(): Promise<FactoryRecord> {
    await Promise.resolve();
    throw new Error('materializer failed');
}

const factory = ((values: Readonly<Partial<FactoryRecord>>): unknown => {
    if (mode === 'resolve') {
        return createLater(values.id ?? '');
    }
    if (mode === 'reject') {
        return rejectLater();
    }
    if (mode === 'thenable') {
        return { then: (): void => undefined };
    }
    return Object.assign(new FactoryRecord(), values);
}) as EntityMaterializer<FactoryRecord>;

function createMetadata(): EntityMetadata<FactoryRecord> {
    const model = new ModelBuilderImplementation();
    model.entity(FactoryRecord, entity => {
        entity.toTable('factory_records');
        entity.hasKey(record => record.id);
        entity.property(record => record.id)
            .hasColumnName('id').hasColumnType('text').isRequired();
        entity.materialize(factory);
    });
    return model.build().getEntity(FactoryRecord);
}

describe('entity materializer synchronous contract', () => {
    const metadata = createMetadata();

    beforeEach(() => {
        mode = 'sync';
    });

    it('allows an ordinary entity factory result', () => {
        const entity = new Materializer().materialize(
            metadata,
            { id: 'record_1' },
            new ChangeTracker(),
        );

        expect(entity).toBeInstanceOf(FactoryRecord);
        expect(entity.id).toBe('record_1');
    });

    it.each(['resolve', 'reject', 'thenable'] as const)(
        'rejects a %s asynchronous factory result before tracking',
        async factoryMode => {
            mode = factoryMode;
            const tracker = new ChangeTracker();
            const unhandled: unknown[] = [];
            const observeUnhandled = (reason: unknown): void => {
                unhandled.push(reason);
            };
            process.on('unhandledRejection', observeUnhandled);
            try {
                expect(() => new Materializer().materialize(
                    metadata,
                    { id: 'record_1' },
                    tracker,
                )).toThrow(
                    'Entity materializer for \'FactoryRecord\' must be synchronous',
                );
                await new Promise<void>(resolve => setImmediate(resolve));

                expect(tracker.entries()).toEqual([]);
                expect(unhandled).toEqual([]);
            } finally {
                process.off('unhandledRejection', observeUnhandled);
            }
        },
    );
});
