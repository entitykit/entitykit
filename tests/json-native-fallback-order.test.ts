import { compileModel, type ModelBuilder as PublicModelBuilder } from '../packages/core/src';
import { Materializer } from '../packages/core/src/experimental';
import { compiledModelMetadata } from '../packages/core/src/model/compiled-model';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';

class JsonRow {
    public id = 0;
    public document: unknown;
}

function metadata(compiled: boolean): EntityMetadata<JsonRow> {
    const configure = (model: PublicModelBuilder): void => {
        model.entity(JsonRow, entity => {
            entity.toTable('json_rows').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer');
            entity.property(row => row.document).hasColumnType('jsonb');
        });
    };
    if (compiled) return compiledModelMetadata(compileModel(configure, { provider: 'postgres' })).getEntity(JsonRow);
    const builder = new ModelBuilder();configure(builder);
    return builder.build().getEntity(JsonRow);
}

describe.each([false, true])('JSON native fallback observations, compiled=%s', compiled => {
    it.each(['Map', 'Set'])('finishes both source traversals before draining a cyclic %s', kind => {
        const model = metadata(compiled), shared = { n: 1 };
        const events: string[] = [];
        let reads = 0;
        const container = kind === 'Map' ? new Map<object, object>() : new Set<object>();
        const source = { a: shared, b: container, get c() {
            events.push('c');return ++reads;
        } };
        if (container instanceof Map) container.set(source, shared);
        else {
            container.add(source);container.add(shared); 
        }
        const iterator = container[Symbol.iterator];
        Object.defineProperty(container, Symbol.iterator, { value: function* (this: typeof container): Generator {
            events.push('iterator');
            yield* Reflect.apply(iterator, this, []) as Iterable<unknown>;
        } });
        const prototype = kind === 'Map' ? Map.prototype : Set.prototype;
        const previous = Object.getOwnPropertyDescriptor(prototype, 'then');
        const observations: unknown[] = [];
        let failure: unknown;
        try {
            Object.defineProperty(prototype, 'then', { configurable: true, value: function (this: typeof container): void {
                events.push('then');
                const pair = this instanceof Map
                    ? this.entries().next().value
                    : Array.from(this.values());
                if (pair?.length !== 2) throw new Error('Expected two captured references.');
                const parent = pair[0] as typeof source, child = pair[1];
                observations.push({
                    parentOwned: parent !== source,
                    childOwned: child !== shared,
                    sharedAlias: parent.a === child,
                    cycle: parent.b === this,
                    laterValue: parent.c,
                });
            } });
            try {
                new Materializer().materializeUntracked(model, { id: 1, document: source });
            } catch (error) {
                failure = error;
            }
        } finally {
            if (previous) Object.defineProperty(prototype, 'then', previous);
            else Reflect.deleteProperty(prototype, 'then');
        }
        expect(events).toEqual(['iterator', 'c', 'iterator', 'c', 'then']);
        expect(reads).toBe(2);
        expect(observations).toEqual([{
            parentOwned: true, childOwned: true, sharedAlias: true, cycle: true, laterValue: 2,
        }]);
        expect(failure).toBeInstanceOf(TypeError);
        expect((failure as Error).message).toContain('\'JsonRow.document.b\' (Promise or thenable)');
    });
});
