import { bufferedIdentityScope } from './support/buffered-identity';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';

describe('buffered identity bound values', () => {
    it.each([false, true])('invalidates a captured key changed by the constructor, accessor=%p', accessor => {
        const original = Object.getOwnPropertyDescriptor(Object.prototype, 'id');
        let captured: Array<Record<string, unknown>> = [], enter = false;
        const scope = bufferedIdentityScope(true, () => {
            if (!enter) return;
            enter = false;expect(captured.length).toBeGreaterThanOrEqual(2);
            if (accessor) Object.defineProperty(captured[1], 'id', { enumerable: true, configurable: true, get: () => 3 });
            else captured[1].id = 3;
        });
        try {
            Object.defineProperty(Object.prototype, 'id', { configurable: true, set: function (this: Record<string, unknown>, value: unknown) {
                Object.defineProperty(this, 'id', { configurable: true, enumerable: true, writable: true, value });captured.push(this);
            } });
            scope.read(1);captured = [];enter = true;
            const root = scope.read(2);
            expect(root.entity.id).toBe(2);expect(root.boundValues.id).toBe(3);
            expect(scope.identities.get(scope.metadata, { id: 2 })).toBeUndefined();
            expect(scope.identities.get(scope.metadata, { id: 3 })).toBe(root.entity);
            expect(materializedPersistenceFacts(root.entity)).toEqual({ values: { id: 2, name: 'value' }, boundValues: { id: 3, name: 'value' } });
        } finally {
            if (original) Object.defineProperty(Object.prototype, 'id', original);
            else Reflect.deleteProperty(Object.prototype, 'id');
        }
    });

    it('preserves primitive type and negative-zero distinctions', () => {
        const scope = bufferedIdentityScope(), values = [0, -0, 1, '1', 1n, true];
        const roots = values.map(value => scope.read(value));
        expect(new Set(roots.map(root => root.entity)).size).toBe(values.length);
        for (let i = 0; i < values.length; i++) expect(scope.read(values[i]).entity).toBe(roots[i].entity);
    });

    it('recomputes mutable object keys and owns returned persistence facts', () => {
        const scope = bufferedIdentityScope();
        const first = scope.read(new Date('2026-01-01')).entity;
        const second = scope.read(new Date('2026-01-02')).entity;
        expect(scope.read(new Date('2026-01-01')).entity).toBe(first);
        expect(second).not.toBe(first);
        (first.id as Date).setUTCFullYear(2027);
        expect(materializedPersistenceFacts(first)?.values.id).toEqual(new Date('2026-01-01'));
        expect(scope.read(new Date('2026-01-01')).entity).toBe(first);
    });
});
