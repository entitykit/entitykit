import { bufferedIdentityScope } from './support/buffered-identity';
import * as identityValue from '../packages/core/src/model/identity-value';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';

describe('buffered identity encoding work', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([false, true])('reduces unique encodings only for compiled buffered execution, compiled=%p', compiled => {
        const scope = bufferedIdentityScope(compiled), encode = jest.spyOn(identityValue, 'encodeIdentityTuple');
        const rows = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `row${String(index + 1)}` }));
        const roots = scope.materializer.materializeManyWithValues(scope.metadata, rows, scope.tracker);
        expect(encode).toHaveBeenCalledTimes(compiled ? 100 : 199);
        for (let i = 0; i < rows.length; i++) {
            expect(roots[i].entity).toEqual(rows[i]);expect(roots[i].values).toEqual(rows[i]);expect(roots[i].boundValues).toEqual(rows[i]);
            expect(materializedPersistenceFacts(roots[i].entity)).toEqual({ values: rows[i], boundValues: rows[i] });
        }
        expect(scope.tracker.entries()).toEqual([]);
    });

    it('limits duplicate adaptation to one metadata identity and resets it on clear', () => {
        const a = bufferedIdentityScope(), b = bufferedIdentityScope();
        const encode = jest.spyOn(identityValue, 'encodeIdentityTuple');
        const readB = (id: number): ReturnType<typeof a.read> => a.materializer.materializeManyWithValues(b.metadata, [{ id, name: 'b' }], a.tracker)[0];
        const first = a.read(1).entity;expect(a.read(1).entity).toBe(first);
        expect(encode).toHaveBeenCalledTimes(2);encode.mockClear();
        expect(readB(1).entity).not.toBe(first);readB(2);
        expect(encode).toHaveBeenCalledTimes(2);encode.mockClear();
        a.read(2);expect(encode).toHaveBeenCalledTimes(2);
        a.identities.clear();encode.mockClear();
        expect(a.identities.get(a.metadata, { id: 1 })).toBeUndefined();
        expect(a.identities.get(b.metadata, { id: 1 })).toBeUndefined();
        expect(encode).not.toHaveBeenCalled();
        expect(a.read(1).entity).not.toBe(first);a.read(2);
        expect(encode).toHaveBeenCalledTimes(2);encode.mockClear();
        readB(1);readB(2);expect(encode).toHaveBeenCalledTimes(2);
    });
});
