import { compileModel } from '../packages/core/src';
import { compiledModelMetadata } from '../packages/core/src/model/compiled-model';
import { Model } from '../packages/core/src/model/model';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { queryIdentityPlan, captureQueryIdentityProof, queryIdentityProofMatches } from '../packages/core/src/materialization/query-identity-receipt';
import { bufferedIdentityScope } from './support/buffered-identity';

/** Use the real copy/ownership boundary for unusual finalized metadata. */
function ownedMetadata(source: EntityMetadata): EntityMetadata {
    const build = jest.spyOn(ModelBuilder.prototype, 'build').mockReturnValueOnce(new Model([source]));
    try {
        return compiledModelMetadata(compileModel(() => undefined, { provider: 'sqlite' })).getEntity(source.ctor);
    } finally {
        build.mockRestore();
    }
}

describe('buffered identity mapping plans', () => {
    it('reuses one immutable mapping plan without sharing row values', () => {
        const scope = bufferedIdentityScope(), plan = queryIdentityPlan(scope.metadata);
        expect(plan).toEqual(['id']);
        expect(Object.isFrozen(plan)).toBe(true);
        expect(queryIdentityPlan(scope.metadata)).toBe(plan);
        scope.read(1);scope.identities.clear();scope.read(2);
        expect(queryIdentityPlan(scope.metadata)).toBe(plan);
    });

    it.each(['missing', 'plain', 'ownEntityEncoder', 'ownKeyAccessor', 'ownKeyEncoder', 'emptyKeys', 'mixedKeys'])('declines unusual owned mapping: %s', change => {
        const source = bufferedIdentityScope(false).metadata as unknown as EntityMetadata;
        if (change === 'missing') Reflect.deleteProperty(source, 'keyMetadata');
        if (change === 'plain') Object.assign(source, { keyMetadata: {} });
        if (change === 'ownEntityEncoder') Object.assign(source, { createIdentityKeyFromProviderValues: source.ctor });
        if (change === 'ownKeyAccessor') Object.assign(source, { key: source.ctor });
        if (change === 'ownKeyEncoder') {
            const key: object = Reflect.get(source, 'keyMetadata') as object;
            Object.assign(key, { createIdentityKeyFromProviderValues: source.ctor });
        }
        if (change === 'emptyKeys') Object.assign(source, { keyProperties: [] });
        if (change === 'mixedKeys') Object.assign(source, { keyProperties: ['id', 12] });
        const metadata = ownedMetadata(source);
        expect(queryIdentityPlan(metadata)).toBeUndefined();
        expect(queryIdentityPlan(metadata)).toBeUndefined();
    });

    it.each([false, true])('covers the tenant exactly once, tenant in primary key=%p', primary => {
        class Row {
            public id = 0; public tenant = '';
        }
        const model = compiledModelMetadata(compileModel(builder => builder.entity(Row, entity => {
            entity.toTable('receipt_tenants').hasKey(row => primary ? [row.id, row.tenant] : row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.tenant).hasColumnType('text').isRequired();
            entity.tenantKey(row => row.tenant);
        }), { provider: 'sqlite' }));
        const metadata = model.getEntity(Row), plan = queryIdentityPlan(metadata);
        expect(plan).toEqual(['id', 'tenant']);
        if (!plan) throw new Error('Expected tenant identity plan');
        const bound = { id: 1, tenant: 'north' };
        const proof = captureQueryIdentityProof(metadata, bound, plan);
        if (!proof) throw new Error('Expected tenant identity proof');
        bound.tenant = 'south';
        expect(queryIdentityProofMatches(proof, metadata, bound)).toBe(false);
    });
});
