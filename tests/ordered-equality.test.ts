import { orderedEqual } from '../packages/core/src/collections/ordered-equality';

describe('ordered equality', () => {
    it('requires equal values in the same order', () => {
        expect(orderedEqual(['id', 'tenant'], ['id', 'tenant'])).toBe(true);
        expect(orderedEqual(['tenant', 'id'], ['id', 'tenant'])).toBe(false);
        expect(orderedEqual(['id'], ['id', 'tenant'])).toBe(false);
        expect(orderedEqual(undefined, [])).toBe(false);
    });
});
