import { compileModel } from '../packages/core/src';
import { Materializer } from '../packages/core/src/experimental';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { compiledModelMetadata } from '../packages/core/src/model/compiled-model';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';
import { entityReadMetadata, PlannedRow } from './support/compiled-entity';
import { requireDefined } from './support/require-defined';

function mapped(column: string): EntityMetadata<PlannedRow> {
    const handle = compileModel(model => model.entity(PlannedRow, entity => {
        entity.toTable('planned_rows').hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer');
        entity.property(row => row.value).hasColumnName(column).hasColumnType('text');
        entity.property(row => row.tail).hasColumnType('integer');
    }), { provider: 'sqlite' });
    return compiledModelMetadata(handle).getEntity<PlannedRow>(PlannedRow);
}

describe('materializer reuse across mapping identities', () => {
    it('switches between owned mappings for the same constructor and switches back', () => {
        const first = mapped('first'), second = mapped('second'), materializer = new Materializer();
        const cases = [[first, 'left:1'], [first, 'left:2'], [second, 'right:3'], [first, 'left:4']] as const;
        const entities: PlannedRow[] = [];
        for (const [index, [metadata, expected]] of cases.entries()) {
            const id = index + 1;
            const entity = materializer.materializeUntracked(metadata, { id, first: `left:${String(id)}`, second: `right:${String(id)}`, tail: 9 });
            entities.push(entity);
            expect(entity).toBeInstanceOf(PlannedRow);
            expect(entity).toEqual({ id, value: expected, tail: 9 });
            const facts = requireDefined(materializedPersistenceFacts(entity));
            expect(facts.values).toEqual({ id, value: expected, tail: 9 });
            expect(facts.boundValues).toEqual(facts.values);
        }
        expect(new Set(entities).size).toBe(4);
    });

    it('observes mutable mappings between calls without confusing an owned mapping', () => {
        const owned = entityReadMetadata(), dynamic = entityReadMetadata(false), materializer = new Materializer();
        expect(materializer.materializeUntracked(owned, { id: 1, stored_value: 'owned', tail: 0 }).value).toBe('owned');
        expect(materializer.materializeUntracked(dynamic, { id: 2, stored_value: 'before', tail: 0 }).value).toBe('before');
        Object.assign(dynamic.properties[1], { columnName: 'changed_column', propertyPath: ['changed'] });
        const changed = materializer.materializeUntracked(dynamic, { id: 3, stored_value: 'wrong', changed_column: 'after', tail: 0 });
        expect(changed.value).toBeUndefined();
        expect(Reflect.get(changed, 'changed')).toBe('after');
        expect(requireDefined(materializedPersistenceFacts(changed)).values).toEqual({ id: 3, value: 'after', tail: 0 });
        expect(materializer.materializeUntracked(owned, { id: 4, stored_value: 'owned again', tail: 0 }).value).toBe('owned again');
    });
});
