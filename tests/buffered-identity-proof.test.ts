import { bufferedIdentityScope } from './support/buffered-identity';
import { captureQueryIdentityProof, queryIdentityPlan, queryIdentityProofMatches } from '../packages/core/src/materialization/query-identity-receipt';
import { EntityMetadata } from '../packages/core/src/model/entity-metadata';

describe('identity receipt ownership and value revalidation', () => {
    it('accepts null as an immutable value and revalidates a later replacement', () => {
        const scope = bufferedIdentityScope(), plan = queryIdentityPlan(scope.metadata);
        if (!plan) throw new Error('Expected compiled identity plan');
        const bound: Record<string, unknown> = { id: null };
        const proof = captureQueryIdentityProof(scope.metadata, bound, plan);
        if (!proof) throw new Error('Expected proof for null');
        expect(queryIdentityProofMatches(proof, scope.metadata, bound)).toBe(true);
        bound.id = 0;
        expect(queryIdentityProofMatches(proof, scope.metadata, bound)).toBe(false);
    });

    it('declines proof capture when an encoder is missing, replaced or accessor-backed', () => {
        const scope = bufferedIdentityScope(), plan = queryIdentityPlan(scope.metadata);
        if (!plan) throw new Error('Expected compiled identity plan');
        const prototype = EntityMetadata.prototype, name = 'createIdentityKeyFromProviderValues';
        const original = Object.getOwnPropertyDescriptor(prototype, name);
        if (!original) throw new Error('Expected encoder descriptor');
        let getters = 0;
        try {
            Reflect.deleteProperty(prototype, name);
            expect(captureQueryIdentityProof(scope.metadata, { id: 1 }, plan)).toBeUndefined();
            Object.defineProperty(prototype, name, { ...original, value: () => 'custom' });
            expect(captureQueryIdentityProof(scope.metadata, { id: 1 }, plan)).toBeUndefined();
            Object.defineProperty(prototype, name, { configurable: true, get: () => {
                getters++;return original.value as unknown;
            } });
            expect(captureQueryIdentityProof(scope.metadata, { id: 1 }, plan)).toBeUndefined();
            expect(getters).toBe(0);
        } finally {
            Object.defineProperty(prototype, name, original);
        }
    });

    it('rejects inherited, accessor and mutable keys without invoking accessors', () => {
        const scope = bufferedIdentityScope(), plan = queryIdentityPlan(scope.metadata);
        if (!plan) throw new Error('Expected compiled identity plan');
        let getters = 0;
        const inherited: Record<string, unknown> = Object.create({ id: 1 }) as Record<string, unknown>;
        const records = [inherited, { get id() {
            getters++;return 1;
        } }, { id: new Date() }, { id: () => 1 }];
        for (const record of records) expect(captureQueryIdentityProof(scope.metadata, record, plan)).toBeUndefined();
        expect(getters).toBe(0);
    });

    it('does not reuse a proof for another metadata identity or an equal but distinct record', () => {
        const scope = bufferedIdentityScope(), other = bufferedIdentityScope(), plan = queryIdentityPlan(scope.metadata);
        if (!plan) throw new Error('Expected compiled identity plan');
        const record = { id: 1 }, proof = captureQueryIdentityProof(scope.metadata, record, plan);
        if (!proof) throw new Error('Expected identity proof');
        expect(queryIdentityProofMatches(proof, scope.metadata, record)).toBe(true);
        expect(queryIdentityProofMatches(proof, other.metadata, record)).toBe(false);
        expect(queryIdentityProofMatches(proof, scope.metadata, { id: 1 })).toBe(false);
    });

    it.each(['delete', 'accessor', 'negativeZero'])('invalidates a later %s change without reading a new getter', change => {
        const scope = bufferedIdentityScope(), plan = queryIdentityPlan(scope.metadata);
        if (!plan) throw new Error('Expected compiled identity plan');
        const record: Record<string, unknown> = { id: -0 };
        const proof = captureQueryIdentityProof(scope.metadata, record, plan);
        if (!proof) throw new Error('Expected identity proof');
        let getters = 0;
        if (change === 'delete') Reflect.deleteProperty(record, 'id');
        else if (change === 'accessor') Object.defineProperty(record, 'id', { get: () => {
            getters++;return -0;
        } });
        else record.id = 0;
        expect(queryIdentityProofMatches(proof, scope.metadata, record)).toBe(false);
        expect(getters).toBe(0);
    });
});
