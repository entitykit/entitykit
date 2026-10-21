import { Materializer } from '../packages/core/src/materialization/materializer';
import {
    materializedPersistenceFacts,
    rememberMaterializedPersistenceFacts,
} from '../packages/core/src/materialization/materialized-bound-values';
import { entityReadMetadata, PlannedRow } from './support/compiled-entity';
import { requireDefined } from './support/require-defined';

describe('materialized facts across reentrant copies and replacement', () => {
    it.each([false, true])('publishes the outer materialization after a nested replacement, compiled=%p', compiled => {
        for (const stage of ['assignment', 'retention']) {
            const holder: { entity?: PlannedRow } = {};
            let retaining = false;
            const replace = (): void => {
                rememberMaterializedPersistenceFacts(requireDefined(holder.entity), metadata,
                    { id: 1, value: new Uint8Array([7]), tail: 2 },
                    { id: 1, value: new Uint8Array([9]), tail: 2 });
            };
            class Row extends PlannedRow {
                constructor() {
                    super();
                    holder.entity = this;
                    let tail = 0;
                    Object.defineProperty(this, 'tail', {
                        get: () => tail,
                        set: (value: number) => {
                            tail = value;
                            if (stage === 'assignment') replace();
                            else retaining = true;
                        },
                    });
                }
            }
            class Bytes extends Uint8Array {
                constructor(buffer: ArrayBuffer) {
                    super(buffer);
                    if (retaining) {
                        retaining = false; replace();
                    }
                }
            }
            const metadata = entityReadMetadata(compiled, Row);
            const value = new Bytes(Uint8Array.from([1, 2]).buffer);
            const entity = new Materializer().materializeUntracked(metadata,
                { id: 1, stored_value: value, tail: 2 });
            const facts = requireDefined(materializedPersistenceFacts(entity));
            expect([...(facts.values.value as Uint8Array)]).toEqual([1, 2]);
            expect([...(facts.boundValues.value as Uint8Array)]).toEqual([1, 2]);
        }
    });

    it.each([false, true])('keeps one fact read on its original snapshot during replacement, compiled=%p', compiled => {
        const entity = new PlannedRow(), metadata = entityReadMetadata(compiled);
        let replace = false;
        class Bytes extends Uint8Array {
            constructor(buffer: ArrayBuffer) {
                super(buffer);
                if (replace) {
                    replace = false;
                    rememberMaterializedPersistenceFacts(entity, metadata,
                        { id: 1, value: new Uint8Array([7]), tail: 2 },
                        { id: 1, value: new Uint8Array([9]), tail: 2 });
                }
            }
        }
        rememberMaterializedPersistenceFacts(entity, metadata,
            { id: 1, value: new Bytes(Uint8Array.from([1]).buffer), tail: 2 },
            { id: 1, value: new Bytes(Uint8Array.from([3]).buffer), tail: 2 });
        replace = true;
        const first = requireDefined(materializedPersistenceFacts(entity));
        expect([...(first.values.value as Uint8Array)]).toEqual([1]);
        expect([...(first.boundValues.value as Uint8Array)]).toEqual([3]);
        const next = requireDefined(materializedPersistenceFacts(entity));
        expect([...(next.values.value as Uint8Array)]).toEqual([7]);
        expect([...(next.boundValues.value as Uint8Array)]).toEqual([9]);
    });

    it.each([false, true])('keeps failed replacement from erasing completed facts, compiled=%p', compiled => {
        const entity = new PlannedRow(), metadata = entityReadMetadata(compiled);
        rememberMaterializedPersistenceFacts(entity, metadata,
            { id: 1, value: 'model', tail: 2 }, { id: 1, value: 'bound', tail: 2 });
        const invalid = Object.defineProperty({}, 'value', {
            enumerable: true, get: () => {
                throw new Error('replacement copy failed');
            },
        });
        expect(() => {
            rememberMaterializedPersistenceFacts(entity, metadata, invalid, {});
        })
            .toThrow('replacement copy failed');
        expect(materializedPersistenceFacts(entity)).toEqual({
            values: { id: 1, value: 'model', tail: 2 },
            boundValues: { id: 1, value: 'bound', tail: 2 },
        });
    });

    it.each([false, true])('publishes facts only after both retention copies complete, compiled=%p', compiled => {
        const holder: { entity?: PlannedRow } = {};
        const observed: unknown[] = [];
        let retaining = false;
        class Row extends PlannedRow {
            constructor() {
                super();
                holder.entity = this;
                let tail = 0;
                Object.defineProperty(this, 'tail', {
                    get: () => tail,
                    set: (value: number) => {
                        tail = value; retaining = true;
                    },
                });
            }
        }
        class Bytes extends Uint8Array {
            constructor(buffer: ArrayBuffer) {
                super(buffer);
                if (retaining) observed.push(materializedPersistenceFacts(requireDefined(holder.entity)));
            }
        }
        const value = new Bytes(Uint8Array.from([1, 2]).buffer);
        const entity = new Materializer().materializeUntracked(entityReadMetadata(compiled, Row),
            { id: 1, stored_value: value, tail: 2 });
        expect(observed).toEqual([undefined, undefined]);
        retaining = false;
        const facts = requireDefined(materializedPersistenceFacts(entity));
        expect([...(facts.values.value as Uint8Array)]).toEqual([1, 2]);
        expect([...(facts.boundValues.value as Uint8Array)]).toEqual([1, 2]);
        expect(facts.values.value).not.toBe(facts.boundValues.value);
        expect(facts.values.value).not.toBe(entity.value);
    });
});
