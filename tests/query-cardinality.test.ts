import { EntityNotFoundError, MultipleEntitiesFoundError } from '../packages/core/src';
import {
    firstResultOrNull,
    requireQueryResult,
    singleResultOrNull,
} from '../packages/core/src/query/query-cardinality';

describe('query cardinality', () => {
    it('reads empty and populated result sets', () => {
        expect(firstResultOrNull([])).toBeNull();
        expect(firstResultOrNull(['first', 'second'])).toBe('first');
        expect(singleResultOrNull([], 'Widget')).toBeNull();
        expect(singleResultOrNull(['only'], 'Widget')).toBe('only');
    });

    it('uses typed errors and operation-specific messages', () => {
        expect(() => requireQueryResult(null, 'Widget', 'projection'))
            .toThrow(EntityNotFoundError);
        expect(() => requireQueryResult(null, 'Widget', 'projection'))
            .toThrow('No \'Widget\' projection matched the query.');
        expect(() => singleResultOrNull(['one', 'two'], 'Widget'))
            .toThrow(MultipleEntitiesFoundError);
        expect(() => singleResultOrNull(['one', 'two'], 'Widget'))
            .toThrow('More than one \'Widget\' entity matched the query.');
    });
});
