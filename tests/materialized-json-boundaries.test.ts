import { compileModel, type EntityMaterializer, type ModelBuilder as PublicModelBuilder } from '../packages/core/src';
import { Materializer } from '../packages/core/src/experimental';
import { compiledModelMetadata } from '../packages/core/src/model/compiled-model';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import { entityReadMetadata } from './support/compiled-entity';

class FactoryRow {
    public id = 0;
    public value: unknown;
}

describe('entity factory result boundaries', () => {
    it.each([null, undefined, false, 0, 'invalid', 7n, Symbol('invalid')])(
        'rejects a non-object factory result before tracking: %p', result => {
            const configure = (model: PublicModelBuilder): void => {
                model.entity(FactoryRow, entity => {
                    entity.toTable('factory_rows').hasKey(row => row.id);
                    entity.property(row => row.id).hasColumnType('integer');
                    entity.property(row => row.value).hasColumnType('jsonb');
                    entity.materialize(((): unknown => result) as EntityMaterializer<FactoryRow>);
                });
            };
            const builder = new ModelBuilder();
            configure(builder);
            const metadata = builder.build().getEntity(FactoryRow);
            const tracker = new ChangeTracker();
            const source = { nested: [1] };
            expect(() => new Materializer().materialize(metadata, { id: 1, value: source }, tracker))
                .toThrow('Entity materializer for \'FactoryRow\' must return an object.');
            expect(tracker.entries()).toEqual([]);
            expect(source).toEqual({ nested: [1] });
        },
    );
});

describe.each([false, true])('materialized JSON boundary behavior, compiled=%s', compiled => {
    it('rejects a proxy refusing a JSON assignment before tracking', () => {
        class RefusingRow {
            public id = 0;
            public value: unknown;
            public tail = 0;
            constructor() {
                return new Proxy(this, {
                    set: (target, key, value, receiver) =>
                        key !== 'value' && Reflect.set(target, key, value, receiver),
                });
            }
        }
        const metadata = entityReadMetadata(compiled, RefusingRow, 'jsonb');
        const tracker = new ChangeTracker(), source = { nested: [1] };
        expect(() => new Materializer().materialize(
            metadata, { id: 1, stored_value: source, tail: 2 }, tracker,
        )).toThrow('Cannot write mapped property \'value\'.');
        expect(tracker.entries()).toEqual([]);
        expect(source).toEqual({ nested: [1] });
    });

    it('keeps a special JSON property writable and configurable', () => {
        class LiteralRow {
            public id = 0;
            [name: string]: unknown;
        }
        const configure = (model: PublicModelBuilder): void => {
            model.entity(LiteralRow, entity => {
                entity.toTable('literal_rows').hasKey(row => row.id);
                entity.property(row => row.id).hasColumnType('integer');
                entity.property(row => row.__proto__).hasColumnName('data').hasColumnType('jsonb');
            });
        };
        const builder = new ModelBuilder();configure(builder);
        const metadata = compiled
            ? compiledModelMetadata(compileModel(configure, { provider: 'postgres' })).getEntity(LiteralRow)
            : builder.build().getEntity(LiteralRow);
        const source = { nested: [1] };
        const row = new Materializer().materializeUntracked(metadata, { id: 1, data: source });
        expect(Object.getOwnPropertyDescriptor(row, '__proto__')).toEqual({
            configurable: true, enumerable: true, writable: true, value: source,
        });
        expect(row.__proto__).not.toBe(source);
        expect(Reflect.set(row, '__proto__', { replacement: true })).toBe(true);
        expect(Reflect.deleteProperty(row, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(row)).toBe(LiteralRow.prototype);
        expect(source).toEqual({ nested: [1] });
    });
});
