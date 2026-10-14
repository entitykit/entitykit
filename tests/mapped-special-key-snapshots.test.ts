import { ModelBuilder } from '../packages/core/src/model/model-builder';
import { Materializer } from '../packages/core/src/experimental';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import { cloneBoundEntityValues } from '../packages/core/src/tracking/bound-entity-value-clone';
import { cloneEntityValues, readEntityValues } from '../packages/core/src/tracking/entity-entry-snapshot';
import { captureMissingBoundEntityValues } from '../packages/core/src/tracking/bound-value-snapshot';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';
import { captureEntityPersistenceFacts } from '../packages/core/src/tracking/entity-persistence-fact-capture';
import { writeSnapshotValue } from '../packages/core/src/tracking/write-snapshot-value';
import { EntityState, valueConverter } from '../packages/core/src';
import { EntityEntry } from '../packages/core/src/tracking/entity-entry';
import { captureReferenceForeignKeyFacts } from '../packages/core/src/tracking/reference-foreign-key-facts';
import { capturePersistedEntrySnapshot, refreshPersistedEntryRelationships } from '../packages/core/src/tracking/persisted-entry-snapshot';

class SpecialRecord {
    public id = 'one';
    public ['__proto__'] = 'original';
}

const metadata = new ModelBuilder().entity(SpecialRecord, entity => {
    entity.toTable('special_records').hasKey(record => record.id);
    entity.property(record => record.id).hasColumnType('text').isRequired();
    entity.property(record => record.__proto__).hasColumnType('text').isRequired();
}).build().getEntity(SpecialRecord);

function expectOwnValue(values: object, value = 'original'): void {
    expect(Object.getOwnPropertyDescriptor(values, '__proto__')).toEqual({
        configurable: true, enumerable: true, writable: true, value,
    });
}

describe('mapped special keys in snapshots', () => {
    it('materializes untracked own values without changing the entity prototype', () => {
        const entity = new Materializer().materializeUntracked(metadata, {
            id: 'one', ['__proto__']: 'original',
        });
        expectOwnValue(entity);
        expect(Object.getPrototypeOf(entity)).toBe(SpecialRecord.prototype);
        entity.__proto__ = 'changed';
        const facts = materializedPersistenceFacts(entity);
        if (!facts) throw new Error('Expected persistence facts.');
        expectOwnValue(facts.values);
        expectOwnValue(facts.boundValues);
    });

    it('retains model and bound values during tracked materialization', () => {
        const tracker = new ChangeTracker();
        const row = new Materializer().materializeWithValues(metadata, {
            id: 'one', ['__proto__']: 'original',
        }, tracker);
        expectOwnValue(row.values);
        expectOwnValue(row.boundValues);
        const entry = tracker.entry(row.entity);
        if (!entry) throw new Error('Expected tracked entry.');
        expectOwnValue(entry.originalValues);
        expectOwnValue(entry.originalBoundValues);
    });

    it('preserves own keys while reading and copying model snapshots', () => {
        const values = { id: 'one', ['__proto__']: 'original' };
        expectOwnValue(readEntityValues(metadata, new SpecialRecord()));
        expectOwnValue(cloneEntityValues(metadata, values));
        expectOwnValue(cloneBoundEntityValues(metadata, values, values));
    });

    it('fills missing bound facts without invoking the inherited prototype setter', () => {
        const boundValues = {};
        captureMissingBoundEntityValues(metadata, {
            id: 'one', ['__proto__']: 'original',
        }, boundValues);
        expectOwnValue(boundValues);
        expect(Object.getPrototypeOf(boundValues)).toBe(Object.prototype);
    });

    it('captures own model and provider facts for persistence', () => {
        const facts = captureEntityPersistenceFacts(metadata, new SpecialRecord());
        expectOwnValue(facts.modelValues);
        expectOwnValue(facts.boundValues);
    });

    it('preserves unchanged and changed special foreign-key facts', () => {
        const entity = new SpecialRecord();
        const entry = new EntityEntry(entity, metadata, EntityState.Unchanged,
            { id: 'one', ['__proto__']: 'original' },
            { id: 'one', ['__proto__']: 'original' }) as unknown as EntityEntry<object>;
        const relationship = { foreignKeyProperties: ['__proto__'] };
        for (const value of ['original', 'changed']) {
            entity.__proto__ = value;
            const facts = captureReferenceForeignKeyFacts(entry, relationship);
            expectOwnValue(facts.modelValues, value);
            expectOwnValue(facts.boundValues, value);
        }
        const snapshot = capturePersistedEntrySnapshot(entry);
        entity.__proto__ = 'refreshed';
        const refreshed = refreshPersistedEntryRelationships(snapshot, new Set(['__proto__']));
        expectOwnValue(refreshed.values, 'refreshed');
        expectOwnValue(refreshed.boundValues, 'refreshed');
    });

    it('clones converted special values without sharing their model objects', () => {
        class ConvertedRecord {
            public id = 'one';
            public ['__proto__'] = { label: 'original' };
        }
        const converter = valueConverter<{ label: string }, string>({
            toProvider: value => value.label,
            fromProvider: label => ({ label }),
        });
        const converted = new ModelBuilder().entity(ConvertedRecord, entity => {
            entity.toTable('converted_records').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.__proto__).hasColumnType('text')
                .hasConversion(converter).isRequired();
        }).build().getEntity(ConvertedRecord);
        const entity = new Materializer().materializeUntracked(converted, {
            id: 'one', ['__proto__']: 'original',
        });
        entity.__proto__.label = 'changed';
        const first = materializedPersistenceFacts(entity);
        const second = materializedPersistenceFacts(entity);
        expect(first?.values.__proto__).toEqual({ label: 'original' });
        expect(first?.values.__proto__).not.toBe(second?.values.__proto__);
        expect(first?.values.__proto__).not.toBe(entity.__proto__);
        expect(first?.boundValues.__proto__).toBe('original');
        expect(Object.getPrototypeOf(entity)).toBe(ConvertedRecord.prototype);
    });

    it.each([undefined, null, 0, false, 'text', { nested: true }])(
        'defines and replaces special snapshot keys for %p', value => {
            const values = {};
            writeSnapshotValue(values, '__proto__', value);
            expect(Object.getOwnPropertyDescriptor(values, '__proto__')).toEqual({
                configurable: true, enumerable: true, writable: true, value,
            });
            expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
            writeSnapshotValue(values, '__proto__', 'replacement');
            expectOwnValue(values, 'replacement');
        },
    );

    it('writes ordinary snapshot keys without cloning their values', () => {
        const values: Record<string, unknown> = {};
        const value = { nested: true };
        for (const key of ['id', 'constructor', 'toString']) {
            writeSnapshotValue(values, key, value);
            expect(values[key]).toBe(value);
        }
        expect(Object.keys(values)).toEqual(['id', 'constructor', 'toString']);
    });
});
