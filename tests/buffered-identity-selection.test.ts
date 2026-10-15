import { compileModel } from '../packages/core/src';
import { compiledModelMetadata } from '../packages/core/src/model/compiled-model';
import { Materializer } from '../packages/core/src/materialization/materializer';
import { QueryIdentityResolution, useQueryIdentityResolution } from '../packages/core/src/materialization/query-identity-resolution';
import { createBufferedQueryIdentities } from '../packages/core/src/materialization/buffered-query-identities';
import { createBufferedQueryMaterializer } from '../packages/core/src/materialization/buffered-query-materializer';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';
import * as identityValue from '../packages/core/src/model/identity-value';
import { bufferedIdentityScope } from './support/buffered-identity';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import type { MaterializedRow } from '../packages/core/src/materialization/materialized-row';

describe('buffered identity execution selection', () => {
    afterEach(() => jest.restoreAllMocks());

    it('retains the generic path for frozen caller-owned metadata and model', () => {
        const scope = bufferedIdentityScope(false);
        Object.freeze(scope.metadata);Object.freeze(scope.model);
        const identities = createBufferedQueryIdentities(scope.model);
        expect(identities.constructor).toBe(QueryIdentityResolution);
        expect(createBufferedQueryMaterializer(undefined, identities).constructor).toBe(Materializer);
        const first = scope.read(1).entity;
        expect(scope.read(1).entity).toBe(first);
    });

    it('keeps direct Materializer subclass row dispatch even with a compiled scope', () => {
        const scope = bufferedIdentityScope();
        const calls: unknown[] = [];
        class CustomMaterializer extends Materializer {
            public override materializeWithValues<TEntity extends object>(
                metadata: EntityMetadata<TEntity>, row: Record<string, unknown>, tracker: ChangeTracker,
            ): MaterializedRow<TEntity> {
                calls.push(row);return super.materializeWithValues(metadata, row, tracker);
            }
        }
        const materializer = useQueryIdentityResolution(new CustomMaterializer(), scope.identities);
        const rows = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
        expect(materializer.materializeManyWithValues(scope.metadata, rows, scope.tracker).map(root => root.entity)).toEqual(rows);
        expect(calls).toEqual(rows);
    });

    it('does not specialize a dynamic batch using a compiled query scope', () => {
        const compiled = bufferedIdentityScope(), dynamic = bufferedIdentityScope(false);
        const encode = jest.spyOn(identityValue, 'encodeIdentityTuple');
        const roots = compiled.materializer.materializeManyWithValues(dynamic.metadata,
            [{ id: 1, name: 'a' }, { id: 2, name: 'b' }], compiled.tracker);
        expect(encode).toHaveBeenCalledTimes(3);
        expect(roots.map(root => root.entity)).toEqual([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
        expect(compiled.tracker.entries()).toEqual([]);
    });

    it('keeps keyless rows separate with owned facts and no tracker entries', () => {
        class Row {
            public id = 0;
        }
        const model = compiledModelMetadata(compileModel(builder => builder.entity(Row, entity => {
            entity.toTable('keyless_receipts').hasNoKey();entity.property(row => row.id).hasColumnType('integer');
        }), { provider: 'sqlite' }));
        const identities = createBufferedQueryIdentities(model), tracker = new ChangeTracker();
        const roots = createBufferedQueryMaterializer(undefined, identities).materializeManyWithValues(model.getEntity(Row), [{ id: 1 }, { id: 1 }], tracker);
        expect(roots[0].entity).not.toBe(roots[1].entity);
        for (const root of roots) expect(materializedPersistenceFacts(root.entity)).toEqual({ values: { id: 1 }, boundValues: { id: 1 } });
        expect(tracker.entries()).toEqual([]);
    });

    it('keeps tracking registration and its callback when there is no query scope', () => {
        const scope = bufferedIdentityScope(), callback = jest.fn();
        const materializer = createBufferedQueryMaterializer(undefined, undefined, callback);
        expect(materializer.constructor).toBe(Materializer);
        const roots = materializer.materializeManyWithValues(scope.metadata,
            [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 1, name: 'c' }], scope.tracker);
        expect(callback).toHaveBeenCalledTimes(2);expect(scope.tracker.entries()).toHaveLength(2);
        expect(roots[2].entity).toBe(roots[0].entity);expect(roots[2].entity.name).toBe('a');
    });

    it('keeps composite and tenant identity tuples distinct', () => {
        class Row {
            public id = 0; public part = ''; public tenant = '';
        }
        const model = compiledModelMetadata(compileModel(builder => builder.entity(Row, entity => {
            entity.toTable('tuple_receipts').hasKey(row => [row.id, row.part]);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.part).hasColumnType('text').isRequired();
            entity.property(row => row.tenant).hasColumnType('text').isRequired();entity.tenantKey(row => row.tenant);
        }), { provider: 'sqlite' }));
        const identities = createBufferedQueryIdentities(model), tracker = new ChangeTracker();
        const rows = [{ id: 1, part: 'a', tenant: 'north' }, { id: 1, part: 'b', tenant: 'north' }, { id: 1, part: 'a', tenant: 'south' }];
        const roots = createBufferedQueryMaterializer(undefined, identities).materializeManyWithValues(model.getEntity(Row), [...rows, rows[0]], tracker);
        expect(new Set(roots.map(root => root.entity)).size).toBe(3);expect(roots[3].entity).toBe(roots[0].entity);
        expect(roots.map(root => root.entity)).toEqual([...rows, rows[0]]);
    });
});
