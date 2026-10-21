import { Materializer } from '../packages/core/src/experimental';
import type { StoreValueReader } from '../packages/core/src/adapter';
import { entityReadMetadata, PlannedRow } from './support/compiled-entity';

describe.each([false, true])('materialization callback contract: compiled=%p', compiled => {
    it('reads each row field and current reader method before constructing the entity', () => {
        const events: string[] = [], receivers: unknown[] = [];
        let reads = 0;
        const reader = Object.defineProperty({}, 'readValue', {
            get: (): StoreValueReader['readValue'] => {
                const call = ++reads;
                events.push(`method:${String(call)}`);
                return function (this: unknown, value: unknown, type: string): unknown {
                    receivers.push(this);
                    events.push(`read:${type}`);
                    return type === 'text' ? `${String(value)}:${String(call)}` : value;
                };
            },
        }) as StoreValueReader;
        class Row extends PlannedRow {
            constructor() {
                super();
                events.push('construct');
            }
        }
        const row = {
            get id(): number {
                events.push('row:id'); return 1;
            },
            get stored_value(): string {
                events.push('row:value'); return 'value';
            },
            get tail(): number {
                events.push('row:tail'); return 2;
            },
        };

        const result = new Materializer(reader).materializeUntracked(
            entityReadMetadata(compiled, Row), row,
        );

        expect(result).toBeInstanceOf(Row);
        expect({ id: result.id, value: result.value, tail: result.tail })
            .toEqual({ id: 1, value: 'value:2', tail: 2 });
        expect(receivers).toEqual([reader, reader, reader]);
        expect(events).toEqual([
            'row:id', 'method:1', 'read:integer',
            'row:value', 'method:2', 'read:text',
            'row:tail', 'method:3', 'read:integer', 'construct',
        ]);
    });

    it('stops a failing scalar reader before later fields and permits a fresh attempt', () => {
        const failure = new Error('read refused');
        const events: string[] = [];
        let fail = true;
        class Row extends PlannedRow {
            constructor() {
                super();
                events.push('construct');
            }
        }
        const metadata = entityReadMetadata(compiled, Row);
        const materializer = new Materializer({ readValue(value, type): unknown {
            events.push(`read:${type}`);
            if (type === 'text' && fail) throw failure;
            return value;
        } });
        const row = {
            id: 1, stored_value: 'value',
            get tail(): number {
                events.push('tail'); return 2;
            },
        };

        expect(() => materializer.materializeUntracked(metadata, row)).toThrow(failure);
        expect(events).toEqual(['read:integer', 'read:text']);
        fail = false;
        const result = materializer.materializeUntracked(metadata, row);

        expect(result.value).toBe('value');
        expect(result.tail).toBe(2);
        expect(events).toEqual([
            'read:integer', 'read:text', 'read:integer', 'read:text',
            'tail', 'read:integer', 'construct',
        ]);
    });

    it('keeps application value iterators and independent copies for scalar mappings', () => {
        let iterations = 0;
        const source = [{ leaf: 0 }];
        Object.defineProperty(source, Symbol.iterator, {
            value: function* (): Generator<{ leaf: number }> {
                yield { leaf: ++iterations };
            },
        });
        const materializer = new Materializer({ readValue(value, type): unknown {
            return type === 'text' ? source : value;
        } });

        const result = materializer.materializeUntracked(
            entityReadMetadata(compiled), { id: 1, stored_value: 'value', tail: 2 },
        );

        expect(iterations).toBe(2);
        expect(result.value).toEqual([{ leaf: 1 }]);
        expect(result.value).not.toBe(source);
        source[0].leaf = 99;
        expect(result.value).toEqual([{ leaf: 1 }]);
        (result.value as Array<{ leaf: number }>)[0].leaf = 77;
        expect(source[0].leaf).toBe(99);
    });

    it('detects in-place setter mutation and keeps the failed instance reserved', () => {
        const shared = new PlannedRow(), source = { items: [1] };
        let assigned: unknown, writes = 0;
        Object.defineProperty(shared, 'value', {
            get: (): unknown => assigned,
            set: (value: unknown): void => {
                writes++;
                assigned = value;
                (value as { items: number[] }).items.push(9);
            },
        });
        class Row extends PlannedRow {
            constructor() {
                super();
                return shared;
            }
        }
        const metadata = entityReadMetadata(compiled, Row);
        const materializer = new Materializer();

        expect(() => materializer.materializeUntracked(metadata, {
            id: 1, stored_value: source, tail: 2,
        })).toThrow('Property \'Row.value\' refused its assigned value.');
        expect(() => materializer.materializeUntracked(metadata, {
            id: 2, stored_value: source, tail: 3,
        })).toThrow('already used for another database row');
        expect(source).toEqual({ items: [1] });
        expect(shared.id).toBe(1);
        expect(writes).toBe(1);
    });
});
