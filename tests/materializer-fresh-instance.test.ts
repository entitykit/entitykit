import { EntityState, valueConverter } from '../packages/core/src';
import { Materializer } from '../packages/core/src/experimental';
import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import type { StoreValueReader } from '../packages/core/src/storage/store-value-reader';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';

class FactoryRow {
    public id = '';
    public name = '';
}

interface MutableValue {
    value: string;
}

class MutatingConverterRow {
    public id = '';
    public payload: MutableValue = { value: '' };
}

class FailingFactoryRow {
    public id = '';
    readonly #writes: string[] = [];

    public get name(): string {
        return this.#writes.at(-1) ?? '';
    }

    public set name(value: string) {
        this.#writes.push(value);
        if (this.#writes.length === 1) {
            throw new Error('materialized setter failed');
        }
    }
}

const mutatingConverter = valueConverter<MutableValue, MutableValue>({
    toProvider: value => ({ ...value }),
    fromProvider: value => {
        const original = value.value;
        value.value = 'mutated-by-converter';
        return { value: original };
    },
});

let singleton = new FactoryRow();
let failingSingleton = new FailingFactoryRow();

function factoryMetadata(): EntityMetadata<FactoryRow> {
    const model = new ModelBuilderImplementation();
    model.entity(FactoryRow, entity => {
        entity.toTable('factory_rows');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.name).hasColumnType('text').isRequired();
        entity.materialize(() => singleton);
    });
    return model.build().getEntity(FactoryRow);
}

describe('materializer fresh-instance contract', () => {
    beforeEach(() => {
        singleton = new FactoryRow();
        failingSingleton = new FailingFactoryRow();
    });

    it('rejects a tracked factory result before applying another row', () => {
        const metadata = factoryMetadata();
        const tracker = new ChangeTracker();
        const materializer = new Materializer();
        const first = materializer.materialize(
            metadata, { id: 'one', name: 'first' }, tracker,
        );

        expect(() => materializer.materialize(
            metadata, { id: 'two', name: 'second' }, tracker,
        )).toThrow(
            'Entity materializer for \'FactoryRow\' returned an entity instance ' +
            'already used for another database row. ' +
            'A materializer must return a fresh instance.',
        );

        expect(first).toBe(singleton);
        expect(singleton).toMatchObject({ id: 'one', name: 'first' });
        expect(tracker.entry(singleton)?.originalValues)
            .toMatchObject({ id: 'one', name: 'first' });
        expect(tracker.entries()).toHaveLength(1);
    });

    it('does not overwrite an already tracked Added instance', () => {
        const metadata = factoryMetadata();
        const tracker = new ChangeTracker();
        singleton.id = 'local';
        singleton.name = 'pending';
        tracker.track(singleton, metadata, EntityState.Added);

        expect(() => new Materializer().materialize(
            metadata, { id: 'database', name: 'stored' }, tracker,
        )).toThrow('A materializer must return a fresh instance.');

        expect(singleton).toMatchObject({ id: 'local', name: 'pending' });
        expect(tracker.entry(singleton)?.state).toBe(EntityState.Added);
    });

    it('rejects duplicate instances in untracked result rows', () => {
        const metadata = factoryMetadata();

        expect(() => new Materializer().materializeManyUntracked(metadata, [
            { id: 'one', name: 'first' },
            { id: 'two', name: 'second' },
        ])).toThrow('A materializer must return a fresh instance.');

        expect(singleton).toMatchObject({ id: 'one', name: 'first' });
    });

    it('normalizes each provider row property exactly once', () => {
        const model = new ModelBuilderImplementation();
        model.entity(FactoryRow, entity => {
            entity.toTable('reader_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.ignore(row => row.name);
        });
        const metadata = model.build().getEntity(FactoryRow);
        let calls = 0;
        const reader: StoreValueReader = {
            readValue: () => {
                calls += 1;
                return calls === 1 ? 'one' : 'two';
            },
        };
        const tracker = new ChangeTracker();

        const row = new Materializer(reader).materialize(
            metadata, { id: 'raw' }, tracker,
        );

        expect(calls).toBe(1);
        expect(row.id).toBe('one');
        expect(tracker.entry(row)?.originalValues.id).toBe('one');
        expect(tracker.entry(row)?.originalBoundValues.id).toBe('one');
        expect(tracker.entry(row)?.modifiedProperties()).toEqual([]);
    });

    it('isolates bound facts from a converter that mutates its input', () => {
        const model = new ModelBuilderImplementation();
        model.entity(MutatingConverterRow, entity => {
            entity.toTable('mutating_converter_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.payload).hasColumnType('json')
                .hasConversion(mutatingConverter).isRequired();
        });
        const metadata = model.build().getEntity(MutatingConverterRow);
        const tracker = new ChangeTracker();
        const providerPayload = { value: 'original' };

        const row = new Materializer().materialize(
            metadata,
            { id: 'row', payload: providerPayload },
            tracker,
        );

        expect(providerPayload).toEqual({ value: 'original' });
        expect(row.payload).toEqual({ value: 'original' });
        expect(tracker.entry(row)?.originalBoundValues.payload)
            .toBe('{"value":"original"}');
        expect(tracker.entry(row)?.modifiedProperties()).toEqual([]);
    });

    it('rejects a reused keyless instance across materializers', () => {
        const model = new ModelBuilderImplementation();
        model.entity(FactoryRow, entity => {
            entity.toTable('keyless_factory_rows').hasNoKey();
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.ignore(row => row.name);
            entity.materialize(() => singleton);
        });
        const metadata = model.build().getEntity(FactoryRow);
        const tracker = new ChangeTracker();

        const first = new Materializer().materialize(
            metadata, { id: 'one' }, tracker,
        );

        expect(() => new Materializer().materialize(
            metadata, { id: 'two' }, tracker,
        )).toThrow('A materializer must return a fresh instance.');
        expect(first.id).toBe('one');
    });

    it('reserves a factory result before applying row values', () => {
        const model = new ModelBuilderImplementation();
        model.entity(FailingFactoryRow, entity => {
            entity.toTable('failing_factory_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.materialize(() => failingSingleton);
        });
        const metadata = model.build().getEntity(FailingFactoryRow);

        expect(() => new Materializer().materializeUntracked(
            metadata, { id: 'one', name: 'first' },
        )).toThrow('materialized setter failed');

        expect(() => new Materializer().materializeUntracked(
            metadata, { id: 'two', name: 'second' },
        )).toThrow('A materializer must return a fresh instance.');
        expect(failingSingleton.id).toBe('one');
    });
});
