import { compileModel, type ModelBuilder as PublicModelBuilder } from '../packages/core/src';
import { compiledModelMetadata } from '../packages/core/src/model/compiled-model';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { Materializer } from '../packages/core/src/materialization/materializer';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';
import { requireDefined } from './support/require-defined';

class RecordRow {
    public id = 0;
    [name: string]: unknown;
}

function metadata(
    compiled: boolean,
    names: readonly string[],
    ctor: typeof RecordRow = RecordRow,
): EntityMetadata<RecordRow> {
    const configure = (model: PublicModelBuilder): void => {
        model.entity(ctor, entity => {
            entity.toTable('retention_rows').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            for (const name of names) entity.property(row => row[name]).hasColumnType('text');
        });
    };
    if (compiled) return compiledModelMetadata(compileModel(configure, { provider: 'sqlite' })).getEntity<RecordRow>(ctor);
    const builder = new ModelBuilder(); configure(builder);
    return builder.build().getEntity<RecordRow>(ctor);
}

function observedBytes(name: string, events: string[], onClone?: () => void): Uint8Array {
    class ObservedBytes extends Uint8Array {
        constructor(buffer: ArrayBuffer) {
            super(buffer);
            events.push(name);
            onClone?.();
        }
    }
    return new ObservedBytes(Uint8Array.from([1, 2]).buffer);
}

describe('compiled captured-record retention observations', () => {
    it.each([false, true])('preserves root key order and owned copies, compiled %s', compiled => {
        const names = ['10', '2', '01', '__proto__', 'constructor', '4294967295', '4294967294'];
        const ordered = ['2', '10', '4294967294', '01', '__proto__', 'constructor', '4294967295'];
        const events: string[] = [];
        const input: Record<string, unknown> = Object.fromEntries<unknown>([['id', 1], ...names.map(name => [name, observedBytes(name, events)] as const)]);
        events.length = 0;
        const entity = new Materializer().materializeUntracked(metadata(compiled, names), input);
        // All writes precede bound-fact and then model-fact retention. The two
        // root copies enumerate numeric keys before insertion-ordered strings.
        expect(events.slice(-2 * names.length)).toEqual([...ordered, ...ordered]);
        events.length = 0;
        const facts = requireDefined(materializedPersistenceFacts(entity));
        expect(events).toEqual([...ordered, ...ordered]);
        expect(Object.keys(facts.values)).toEqual(['2', '10', '4294967294', 'id', '01', '__proto__', 'constructor', '4294967295']);
        expect(Object.keys(facts.boundValues)).toEqual(Object.keys(facts.values));
        for (const name of names) {
            const value = facts.values[name] as Uint8Array;
            const bound = facts.boundValues[name] as Uint8Array;
            expect([...value]).toEqual([1, 2]);
            expect([...bound]).toEqual([1, 2]);
            expect(value).not.toBe(entity[name]);
            expect(value).not.toBe(input[name]);
            expect(bound).not.toBe(value);
            expect(Object.getOwnPropertyDescriptor(facts.values, name)).toEqual({
                configurable: true, enumerable: true, writable: true, value,
            });
            value[0] = 9;
            bound[0] = 8;
            (entity[name] as Uint8Array)[0] = 7;
            (input[name] as Uint8Array)[0] = 6;
        }
        const again = requireDefined(materializedPersistenceFacts(entity));
        for (const name of names) {
            expect([...(again.values[name] as Uint8Array)]).toEqual([1, 2]);
            expect([...(again.boundValues[name] as Uint8Array)]).toEqual([1, 2]);
        }
        expect(Object.getPrototypeOf(facts.values)).toBe(Object.prototype);
        expect(Object.getPrototypeOf(entity)).toBe(RecordRow.prototype);
    });

    it.each([false, true])('retains clone-hook changes in later model fields, compiled %s', compiled => {
        let retaining = false;
        const holder: { value?: RecordRow } = {};
        const events: string[] = [];
        class Row extends RecordRow {
            constructor() {
                super();
                holder.value = this;
                let tail = 0;
                Object.defineProperty(this, 'tail', {
                    get: () => tail,
                    set: (value: number) => {
                        tail = value;retaining = true;
                    },
                });
            }
        }
        const first = observedBytes('2', events, () => {
            if (retaining) (requireDefined(holder.value)['10'] as Uint8Array)[0] = 9;
        });
        const last = observedBytes('10', events);
        const entity = new Materializer().materializeUntracked(metadata(compiled, ['10', '2', 'tail'], Row), {
            id: 1, 10: last, 2: first, tail: 1,
        });
        retaining = false;
        const facts = requireDefined(materializedPersistenceFacts(entity));
        expect([...(facts.values['10'] as Uint8Array)]).toEqual([9, 2]);
        expect([...(facts.boundValues['10'] as Uint8Array)]).toEqual([1, 2]);
        expect([...last]).toEqual([1, 2]);
        expect(events.slice(-4)).toEqual(['2', '10', '2', '10']);
    });

    it.each([false, true])('keeps a failed retention instance reserved, compiled %s', compiled => {
        let retaining = false;
        const holder: { value?: RecordRow } = {};
        const events: string[] = [];
        class Row extends RecordRow {
            constructor() {
                super();
                if (holder.value) return holder.value;
                holder.value = this;
                let tail = 0;
                Object.defineProperty(this, 'tail', {
                    get: () => tail,
                    set: (value: number) => {
                        tail = value;retaining = true;
                    },
                });
            }
        }
        const first = observedBytes('2', events, () => {
            if (retaining) throw new Error('retention copy failed');
        });
        const last = observedBytes('10', events);
        const input = { id: 1, 10: last, 2: first, tail: 1 };
        const model = metadata(compiled, ['10', '2', 'tail'], Row);
        const materializer = new Materializer();
        expect(() => materializer.materializeUntracked(model, input)).toThrow('retention copy failed');
        expect(events.at(-1)).toBe('2');
        expect(materializedPersistenceFacts(requireDefined(holder.value))).toBeUndefined();
        retaining = false;
        expect(() => materializer.materializeUntracked(model, input)).toThrow('already used for another database row');
        expect(materializedPersistenceFacts(requireDefined(holder.value))).toBeUndefined();
    });
});
