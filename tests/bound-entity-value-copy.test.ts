import { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import type { ValueConverter } from '../packages/core/src/model/value-converter/converter';
import { cloneBoundEntityValues } from '../packages/core/src/tracking/bound-entity-value-clone';

class CopyRow {}
function metadata(converters: Record<string, ValueConverter> = {}): EntityMetadata<CopyRow> {
    return new EntityMetadata({
        ctor: CopyRow, tableName: 'rows', isKeyless: true,
        properties: ['first', 'second', '1', '2'].map(name => ({
            propertyName: name, propertyPath: [name], columnName: name, columnType: 'text',
            isRequired: false, isPrimaryKey: false, isUnique: false,
            isConcurrencyToken: false, isVersion: false, converter: converters[name],
        })),
    });
}

describe('bound model-value copying', () => {
    it('captures root getters before conversion and ignores a replaced model graph', () => {
        const events: string[] = [];
        let later = 'before';
        const model = metadata({ first: {
            toProvider() {
                throw new Error('Retained provider facts must be used.');
            },
            fromProvider(value) {
                events.push('convert');
                later = 'after';
                return { value };
            },
        } });
        const values = {
            get first() {
                events.push('first');
                return { get unused() {
                    throw new Error('Replaced graph must not be cloned.');
                } };
            },
            get second() {
                events.push('second'); return later;
            },
        };
        expect(cloneBoundEntityValues(model, values, { first: 'stored' }))
            .toEqual({ first: { value: 'stored' }, second: 'before' });
        expect(events).toEqual(['first', 'second', 'convert']);
    });

    it('owns independent cyclic graphs for unconverted fields', () => {
        const graph: { label: string; self?: unknown } = { label: 'original' };
        graph.self = graph;
        const copy = cloneBoundEntityValues(metadata(), { first: graph, second: graph }, {}) as {
            first: typeof graph; second: typeof graph;
        };
        expect(copy.first).not.toBe(graph);
        expect(copy.second).not.toBe(copy.first);
        expect(copy.first.self).toBe(copy.first);
        expect(copy.second.self).toBe(copy.second);
    });

    it('clones retained provider objects before handing them to converters', () => {
        const graph = { nested: { label: 'original' } };
        const model = metadata({ first: {
            toProvider: value => value,
            fromProvider(value) {
                const received = value as typeof graph;
                received.nested.label = 'converted';
                return received;
            },
        } });
        const copy = cloneBoundEntityValues(model, { first: 'model' }, { first: graph });
        expect(copy.first).toEqual({ nested: { label: 'converted' } });
        expect(graph.nested.label).toBe('original');
    });

    it('preserves proxy enumeration order for converter calls', () => {
        const calls: string[] = [];
        const converter = (key: string): ValueConverter => ({
            toProvider: value => value,
            fromProvider(value) {
                calls.push(key); return value;
            },
        });
        const values = new Proxy({ 1: 'one', 2: 'two' }, {
            ownKeys() {
                calls.push('keys'); return ['2', '1'];
            },
        });
        expect(cloneBoundEntityValues(metadata({ 1: converter('1'), 2: converter('2') }),
            values, { 1: 'stored one', 2: 'stored two' }))
            .toEqual({ 1: 'stored one', 2: 'stored two' });
        expect(calls).toEqual(['keys', '2', '1']);
    });

    it('does not read symbol accessors', () => {
        const values = { first: { label: 'original' } };
        Object.defineProperty(values, Symbol('ignored'), {
            enumerable: true,
            get() {
                throw new Error('Symbol must not be read.');
            },
        });
        const copy = cloneBoundEntityValues(metadata(), values, {});
        expect(Reflect.ownKeys(copy)).toEqual(['first']);
        expect(copy.first).toEqual(values.first);
        expect(copy.first).not.toBe(values.first);
    });
});
