import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { Materializer } from '../packages/core/src/experimental';
import type { StoreValueReader } from '../packages/core/src/storage/store-value-reader';
import { readStoreValue } from '../packages/core/src/storage/store-value-reader';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';

const property = { columnType: 'text' };

class ReaderRecord {
    public id!: string;
}

function createMetadata(): EntityMetadata<ReaderRecord> {
    const model = new ModelBuilderImplementation();
    model.entity(ReaderRecord, entity => {
        entity.toTable('reader_records');
        entity.hasKey(record => record.id);
        entity.property(record => record.id)
            .hasColumnName('id').hasColumnType('text').isRequired();
    });
    return model.build().getEntity(ReaderRecord);
}

describe('store value reader synchronous contract', () => {
    it('allows an ordinary provider-normalized value', () => {
        const reader: StoreValueReader = {
            readValue: value => `read:${String(value)}`,
        };

        expect(readStoreValue('value', property, reader)).toBe('read:value');
    });

    it('rejects promises and custom thenables', () => {
        const promiseReader: StoreValueReader = {
            readValue: async value => {
                await Promise.resolve();
                return value;
            },
        };
        const thenableReader: StoreValueReader = {
            readValue: () => ({ then: (): void => undefined }),
        };

        expect(() => readStoreValue('value', property, promiseReader)).toThrow(
            'StoreValueReader.readValue() must be synchronous and must not return a Promise.',
        );
        expect(() => readStoreValue('value', property, thenableReader)).toThrow(
            'StoreValueReader.readValue() must be synchronous',
        );
    });

    it('does not track an entity after an asynchronous reader result', () => {
        const reader: StoreValueReader = {
            readValue: async value => {
                await Promise.resolve();
                return value;
            },
        };
        const tracker = new ChangeTracker();

        expect(() => new Materializer(reader).materialize(
            createMetadata(),
            { id: 'record_1' },
            tracker,
        )).toThrow('StoreValueReader.readValue() must be synchronous');
        expect(tracker.entries()).toEqual([]);
    });

    it('consumes a rejected reader promise', async () => {
        const unhandled: unknown[] = [];
        const observeUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        const reader: StoreValueReader = {
            readValue: async () => {
                await Promise.resolve();
                throw new Error('reader failed');
            },
        };

        process.on('unhandledRejection', observeUnhandled);
        try {
            expect(() => readStoreValue('value', property, reader)).toThrow(
                'StoreValueReader.readValue() must be synchronous',
            );
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', observeUnhandled);
        }
    });
});
