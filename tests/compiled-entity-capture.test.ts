import { Materializer } from '../packages/core/src/materialization/materializer';
import { captureMaterializedValues } from '../packages/core/src/materialization/materialized-value-capture';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';
import { QueryIdentityResolution, useQueryIdentityResolution } from '../packages/core/src/materialization/query-identity-resolution';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import type { StoreValueReader } from '../packages/core/src/storage/store-value-reader';
import { entityReadMetadata, PlannedRow } from './support/compiled-entity';
import { requireDefined } from './support/require-defined';

describe('compiled entity capture and lifetime', () => {
    it('keeps reader method lookup, receiver, nullable values and field order live', () => {
        const metadata = entityReadMetadata();
        const events: string[] = [];
        let calls = 0;
        const reader = Object.defineProperty({}, 'readValue', { get: () => {
            events.push('method');
            return function (this: object, value: unknown, type: string): unknown {
                expect(this).toBe(reader);events.push(`${type}:${String(value)}`);
                return `${String(++calls)}:${String(value)}`;
            };
        } }) as StoreValueReader;
        const captured = captureMaterializedValues(metadata, { id: 1, stored_value: null, tail: 2 }, reader);
        expect(captured).toEqual({ values: { id: '1:1', value: null, tail: '2:2' }, boundValues: { id: '1:1', value: null, tail: '2:2' } });
        expect(events).toEqual(['method', 'integer:1', 'method', 'integer:2']);
        expect(captureMaterializedValues(metadata, {}).values).toEqual({ id: undefined, value: undefined, tail: undefined });
        expect(captureMaterializedValues(metadata, {}, reader).values).toEqual({ id: undefined, value: undefined, tail: undefined });
        expect(events).toHaveLength(4);
    });

    it('captures every provider field before constructor and ordered entity writes', () => {
        const all: unknown[] = [];
        for (const compiled of [false, true]) {
            const events: string[] = [];
            const raw = { nested: [1] };
            class Row extends PlannedRow {
                constructor() {
                    super();events.push('construct');raw.nested.push(9);
                    return new Proxy(this, {
                        set: (target, key, value, receiver) => {
                            events.push(`set ${String(key)}`);return Reflect.set(target, key, value, receiver);
                        },
                        get: (target, key, receiver) => {
                            events.push(`get ${String(key)}`);return Reflect.get(target, key, receiver) as unknown;
                        },
                    });
                }
            }
            const metadata = entityReadMetadata(compiled, Row);
            const reader: StoreValueReader = { readValue(value, type) {
                events.push(`read ${type}`);return value;
            } };
            const row = {
                get id() {
                    events.push('row id');return 1;
                },
                get stored_value() {
                    events.push('row value');return raw;
                },
                get tail() {
                    events.push('row tail');return 3;
                },
            };
            const entity = new Materializer(reader).materializeUntracked(metadata, row);
            const facts = materializedPersistenceFacts(entity);
            expect(events.slice(0, 7)).toEqual(['row id', 'read integer', 'row value', 'read text', 'row tail', 'read integer', 'construct']);
            expect(entity.value).toEqual({ nested: [1] });
            all.push({ events, facts });
        }
        expect(all[1]).toEqual(all[0]);
    });

    it.each(['invalidDate', 'jsonCycle', 'thenable', 'throw'])('fails before construction: %s', kind => {
        const errors: string[] = [];
        for (const compiled of [false, true]) {
            const created = jest.fn();
            class Row extends PlannedRow {
                constructor() {
                    super();created();
                }
            }
            const metadata = entityReadMetadata(compiled, Row, kind === 'jsonCycle' ? 'json' : 'timestamp');
            const cycle: { self?: unknown } = {};cycle.self = cycle;
            const readValue = jest.fn((value: unknown, type: string) => {
                if (type === 'integer') return value;
                if (kind === 'throw') throw new Error('reader failed');
                if (kind === 'thenable') return { then: (): void => undefined };
                return kind === 'invalidDate' ? new Date(NaN) : cycle;
            });
            try {
                new Materializer({ readValue }).materializeUntracked(metadata, { id: 1, stored_value: 'value', tail: 3 });
                throw new Error('expected failure');
            } catch (error) {
                errors.push((error as Error).message);
            }
            expect(created).not.toHaveBeenCalled();expect(readValue).toHaveBeenCalledTimes(2);
        }
        expect(errors[1]).toBe(errors[0]);expect(errors[0]).not.toBe('expected failure');
    });

    it('retains public capture aliases and query-local duplicate identity without sharing facts', () => {
        const metadata = entityReadMetadata();
        const tracker = new ChangeTracker();
        const materializer = useQueryIdentityResolution(new Materializer(), new QueryIdentityResolution());
        const first = materializer.materializeWithValues(metadata, { id: 1, stored_value: { nested: [1] }, tail: 2 }, tracker);
        const duplicate = materializer.materializeWithValues(metadata, { id: 1, stored_value: { nested: [9] }, tail: 3 }, tracker);
        expect(duplicate.entity).toBe(first.entity);expect(first.values.value).toBe(first.entity.value);
        expect(first.boundValues.value).not.toBe(first.entity.value);
        expect(duplicate.values.value).toEqual({ nested: [9] });expect(duplicate.values.value).not.toBe(first.values.value);
        (first.values.value as { nested: number[] }).nested.push(7);
        expect(requireDefined(materializedPersistenceFacts(first.entity)).values.value).toEqual({ nested: [1] });
        expect(tracker.entries()).toEqual([]);
        const separate = useQueryIdentityResolution(new Materializer(), new QueryIdentityResolution())
            .materialize(metadata, { id: 1, stored_value: 'fresh', tail: 2 }, tracker);
        expect(separate).not.toBe(first.entity);
        expect(separate.value).toBe('fresh');
    });

    it('preserves reentrant identity collision and the inner registration', () => {
        for (const compiled of [false, true]) {
            const materializer = useQueryIdentityResolution(new Materializer(), new QueryIdentityResolution());
            const tracker = new ChangeTracker();
            let reenter = true;
            let inner: PlannedRow | undefined;
            class Row extends PlannedRow {
                constructor() {
                    super();
                    if (reenter) {
                        reenter = false;
                        inner = materializer.materialize(metadata, { id: 1, stored_value: 'inner', tail: 2 }, tracker);
                    }
                }
            }
            const metadata = entityReadMetadata(compiled, Row);
            expect(() => materializer.materialize(metadata, { id: 1, stored_value: 'outer', tail: 3 }, tracker)).toThrow('Query identity collision for \'Row\'.');
            const next = materializer.materialize(metadata, { id: 1, stored_value: 'later', tail: 4 }, tracker);
            expect(next).toBe(inner);expect(next.value).toBe('inner');expect(tracker.entries()).toEqual([]);
        }
    });

    it('does not retain a reader in the shared mapping plan', () => {
        const metadata = entityReadMetadata();
        const first = new Materializer({ readValue: value => typeof value === 'string' ? `first:${value}` : value });
        const second = new Materializer({ readValue: value => typeof value === 'string' ? `second:${value}` : value });
        const row = { id: 1, stored_value: 'value', tail: 2 };
        expect(first.materializeUntracked(metadata, row).value).toBe('first:value');
        expect(second.materializeUntracked(metadata, row).value).toBe('second:value');
        expect(first.materializeUntracked(metadata, row).value).toBe('first:value');
    });

    it('keeps a failed constructor instance reserved before another row can write it', () => {
        for (const compiled of [false, true]) {
            const shared = new PlannedRow();
            const setter = jest.fn(() => {
                throw new Error('write failed');
            });
            Object.defineProperty(shared, 'value', { set: setter });
            class Row extends PlannedRow {
                constructor() {
                    super();return shared;
                }
            }
            const metadata = entityReadMetadata(compiled, Row);
            const materializer = new Materializer();
            expect(() => materializer.materializeUntracked(metadata, { id: 1, stored_value: 'one' })).toThrow('write failed');
            expect(() => materializer.materializeUntracked(metadata, { id: 2, stored_value: 'two' })).toThrow('already used for another database row');
            expect(shared.id).toBe(1);expect(setter).toHaveBeenCalledTimes(1);
            expect(materializedPersistenceFacts(shared)).toBeUndefined();
        }
    });
});
