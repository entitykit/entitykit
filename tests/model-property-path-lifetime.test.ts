import {
    isModelPropertyToken,
    selectPropertyPath,
    type ModelPropertyPathSelector,
    type ModelPropertyPathToken,
} from '../packages/core/src/model/model-property-selector';

interface PathRow { id: number; profile: { name: string } }

describe('model property path lifetime', () => {
    it('rejects a root selector and creates an independent root for the next call', () => {
        let root: object | undefined;
        expect(() => selectPropertyPath<PathRow>((row: ModelPropertyPathSelector<PathRow>) => {
            root = row;
            return row as never;
        })).toThrow('must return a direct property access');
        expect(isModelPropertyToken(root)).toBe(false);
        Object.defineProperty(root, 'marker', { enumerable: true, value: true });
        expect(selectPropertyPath<PathRow>((row: ModelPropertyPathSelector<PathRow>) => {
            expect(row).not.toBe(root);
            expect(Object.keys(row)).toEqual([]);
            return row.id;
        })).toEqual(['id']);
    });

    it('keeps direct and nested paths independent across selector calls', () => {
        const select = (row: ModelPropertyPathSelector<PathRow>): ModelPropertyPathToken<PathRow, string> => row.profile.name;
        const first = selectPropertyPath<PathRow>(select);
        const second = selectPropertyPath<PathRow>(select);
        expect(first).toEqual(['profile', 'name']);
        expect(second).toEqual(first);
        expect(second).not.toBe(first);
        (first as string[])[0] = 'changed';
        expect(second).toEqual(['profile', 'name']);
        expect(selectPropertyPath<PathRow>((row: ModelPropertyPathSelector<PathRow>) => row.id))
            .toEqual(['id']);
    });

    it('retains nested tokens independently of the selector invocation', () => {
        let retained: ModelPropertyPathSelector<PathRow>['profile'] | undefined;
        expect(selectPropertyPath<PathRow>((row: ModelPropertyPathSelector<PathRow>) => {
            retained = row.profile;
            return retained.name;
        })).toEqual(['profile', 'name']);
        expect(isModelPropertyToken(retained)).toBe(true);
        const path = selectPropertyPath<PathRow>(() => retained as never);
        expect(path).toEqual(['profile']);
        (path as string[]).length = 0;
        expect(isModelPropertyToken(retained)).toBe(false);
        expect(() => selectPropertyPath<PathRow>(() => retained as never))
            .toThrow('must return a direct property access');
    });
});
