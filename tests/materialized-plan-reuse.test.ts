import { compileModel, type ModelBuilder as PublicModelBuilder } from '../packages/core/src';
import { Materializer } from '../packages/core/src/experimental';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { compiledModelMetadata } from '../packages/core/src/model/compiled-model';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import { entityReadMetadata, PlannedRow } from './support/compiled-entity';
import { requireDefined } from './support/require-defined';

function metadataFor<TEntity extends { id: number }>(
    ctor: new () => TEntity,
    fields: Record<string, string>,
    compiled: boolean,
): EntityMetadata<TEntity> {
    const configure = (model: PublicModelBuilder): void => {
        model.entity<TEntity>(ctor, entity => {
            entity.toTable(ctor.name.toLowerCase()).hasKey('id' as Extract<keyof TEntity, string>);
            for (const [name, type] of Object.entries(fields)) entity.property(name as Extract<keyof TEntity, string>).hasColumnType(type);
        });
    };
    if (compiled) return compiledModelMetadata(compileModel(configure, { provider: 'sqlite' })).getEntity<TEntity>(ctor);
    const builder = new ModelBuilder();configure(builder);return builder.build().getEntity<TEntity>(ctor);
}

describe.each([[false, false], [false, true], [true, false], [true, true]])(
    'reentrant materialization: outer compiled=%p, inner compiled=%p', (outerCompiled, innerCompiled) => {
        it.each(['reader', 'constructor'])('keeps different mappings isolated after a nested %s call', phase => {
            let onConstruct: (() => void) | undefined;
            class Outer {
                public id = 0;
                public document: unknown;
                constructor() {
                    onConstruct?.();
                }
            }
            class Inner {
                public id = 0;
                public note = '';
            }
            const outerMetadata = metadataFor(Outer, { id: 'integer', document: 'jsonb' }, outerCompiled);
            const innerMetadata = metadataFor(Inner, { id: 'integer', note: 'text' }, innerCompiled);
            const tracker = new ChangeTracker();
            let inner: Inner | undefined;
            const materializer = new Materializer({ readValue(value, type): unknown {
                if (phase === 'reader' && type === 'jsonb') nested();
                return value;
            } });
            function nested(): void {
                inner = materializer.materializeWithValues(innerMetadata, { id: 1, note: 'nested' }, tracker).entity;
            }
            if (phase === 'constructor') onConstruct = nested;
            const source = { nested: [1] };
            const captured = materializer.materializeWithValues(outerMetadata, { id: 1, document: source }, tracker);
            const entity = captured.entity;
            expect(entity).toBeInstanceOf(Outer);
            expect(inner).toBeInstanceOf(Inner);
            expect(entity).toEqual({ id: 1, document: { nested: [1] } });
            expect(requireDefined(inner)).toEqual({ id: 1, note: 'nested' });
            expect(tracker.entries()).toHaveLength(2);
            expect(captured.boundValues).toEqual({ id: 1, document: '{"nested":[1]}' });
            (entity.document as { nested: number[] }).nested.push(9);
            source.nested.push(8);
            const facts = requireDefined(materializedPersistenceFacts(entity));
            expect(facts.values).toEqual({ id: 1, document: { nested: [1] } });
            expect(facts.boundValues).toEqual(captured.boundValues);
            expect(requireDefined(materializedPersistenceFacts(requireDefined(inner))).values)
                .toEqual({ id: 1, note: 'nested' });
        });
    },
);

describe('materialized row mapping boundaries', () => {
    it.each([false, true])('keeps function-valued constructor failures reserved, compiled=%p', compiled => {
        const returned = (): void => undefined;
        class Row extends PlannedRow {
            constructor() {
                super();return returned as unknown as Row;
            }
        }
        const metadata = entityReadMetadata(compiled, Row), materializer = new Materializer();
        expect(() => materializer.materializeUntracked(metadata, { id: 1, stored_value: 'a', tail: 2 }))
            .toThrow('Property \'Row.id\' refused its assigned value.');
        expect(Reflect.get(returned, 'id')).toBe(1);
        expect(() => materializer.materializeUntracked(metadata, { id: 2, stored_value: 'b', tail: 3 }))
            .toThrow('already used for another database row');
    });

    it('honors a dynamic mapping changed during construction', () => {
        class Row extends PlannedRow {
            constructor() {
                super();
                Object.assign(metadata.properties[1], { propertyPath: ['changed'] });
            }
        }
        const metadata = entityReadMetadata(false, Row);
        const entity = new Materializer().materializeUntracked(metadata, { id: 1, stored_value: { x: 2 }, tail: 3 });
        expect(entity.value).toBeUndefined();
        expect(Reflect.get(entity, 'changed')).toEqual({ x: 2 });
        expect(requireDefined(materializedPersistenceFacts(entity)).values).toEqual({ id: 1, value: { x: 2 }, tail: 3 });
    });
});
