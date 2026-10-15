import { bufferedIdentityScope } from './support/buffered-identity';
import { BufferedQueryIdentities } from '../packages/core/src/materialization/buffered-query-identities';

describe('buffered identity lifetime and collision ownership', () => {
    it('allows idempotent registration while rejecting a distinct object at the same identity', () => {
        const scope = bufferedIdentityScope();
        const identities = scope.identities as BufferedQueryIdentities;
        const first = scope.read(1).entity;
        expect(() => {
            identities.addReceipt(scope.metadata, { id: 1 }, first, undefined);
        }).not.toThrow();
        expect(() => {
            identities.addReceipt(scope.metadata, { id: 1 }, { id: 1, name: 'other' }, undefined);
        }).toThrow('Query identity collision');
        expect(identities.get(scope.metadata, { id: 1 })).toBe(first);
    });

    it.each([false, true])('preserves an inner constructor registration, compiled=%p', compiled => {
        let enter = false;
        let inner: object | undefined;
        const scope = bufferedIdentityScope(compiled, () => {
            if (enter) {
                enter = false;inner = scope.read(2, 'inner').entity;
            }
        });
        scope.read(1);enter = true;
        expect(() => scope.read(2, 'outer')).toThrow('Query identity collision');
        expect(scope.read(2).entity).toBe(inner);
        expect(inner).toEqual({ id: 2, name: 'inner' });
        expect(scope.tracker.entries()).toEqual([]);
    });

    it.each([false, true])('consults the current insertion table after constructor clear, repopulate=%p', repopulate => {
        let enter = false;
        let inner: object | undefined;
        const scope = bufferedIdentityScope(true, () => {
            if (enter) {
                enter = false;scope.identities.clear();
                if (repopulate) inner = scope.read(2, 'inner').entity;
            }
        });
        scope.read(1);enter = true;
        if (repopulate) {
            expect(() => scope.read(2, 'outer')).toThrow('Query identity collision');
            expect(scope.read(2).entity).toBe(inner);
        } else {
            const outer = scope.read(2, 'outer').entity;
            expect(scope.read(2).entity).toBe(outer);
        }
        expect(scope.identities.get(scope.metadata, { id: 1 })).toBeUndefined();
    });

    it('skips key reads without a table and holds the lookup table through clear', () => {
        const scope = bufferedIdentityScope();
        let reads = 0;
        const bound = { get id() {
            reads++;scope.identities.clear();return 1;
        } };
        expect(scope.identities.get(scope.metadata, bound)).toBeUndefined();
        expect(reads).toBe(0);
        const first = scope.read(1).entity;
        expect(scope.identities.get(scope.metadata, bound)).toBe(first);
        expect(reads).toBe(1);
        expect(scope.identities.get(scope.metadata, { id: 1 })).toBeUndefined();
    });

    it('publishes before fallback encoding and does not restore a table cleared by the key getter', () => {
        const scope = bufferedIdentityScope();
        expect(scope.identities).toBeInstanceOf(BufferedQueryIdentities);
        const identities = scope.identities as BufferedQueryIdentities;
        const events: string[] = [];
        const bound = { get id() {
            identities.get(scope.metadata, { get id() {
                events.push('published');return 2;
            } });
            identities.clear();return 1;
        } };
        identities.addReceipt(scope.metadata, bound, { id: 1, name: 'fresh' }, undefined);
        expect(events).toEqual(['published']);
        expect(identities.get(scope.metadata, { id: 1 })).toBeUndefined();
    });

    it('retains existing identities after a constructor fails on the duplicate path', () => {
        let fail = false;
        const scope = bufferedIdentityScope(true, () => {
            if (fail) throw new Error('constructor refused');
        });
        const first = scope.read(1).entity;
        expect(scope.read(1).entity).toBe(first);
        fail = true;expect(() => scope.read(2)).toThrow('constructor refused');fail = false;
        expect(scope.read(1).entity).toBe(first);
        expect(scope.identities.get(scope.metadata, { id: 2 })).toBeUndefined();
        const second = scope.read(2).entity;
        expect(scope.read(2).entity).toBe(second);
        scope.identities.clear();expect(scope.read(1).entity).not.toBe(first);
        expect(scope.tracker.entries()).toEqual([]);
    });
});
