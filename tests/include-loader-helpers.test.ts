import type { EntityMetadata } from '../src/model/entity-metadata';
import type { StoreValueReader } from '../src/storage/store-value-reader';
import {
    getUniqueObjectList,
    groupIncludes,
    isCompleteTuple,
    lookupKey,
    mergeNavigationItems,
    pushUnique,
    pushUniqueObject,
    readKeyColumn,
    tupleLookupKey,
    uniqueEntityInstances,
    uniqueTuples,
    uniqueValues,
} from '../src/query/include-loader-helpers';
import type {
    IncludeExpression,
    IncludeFilterModel,
} from '../src/query/query-model';

interface Blog {
    posts: object[];
    profile: object;
}

describe('include loader helpers', () => {
    it('groups direct and nested include paths by their first navigation', () => {
        const directFilter: IncludeFilterModel = {
            orderings: [],
            limit: 2,
        };
        const nestedFilter: IncludeFilterModel = {
            orderings: [],
            offset: 1,
        };
        const includes: Array<IncludeExpression<Blog>> = [
            {
                navigationProperty: 'posts',
                navigationPath: ['posts'],
                filter: directFilter,
            },
            {
                navigationProperty: 'posts',
                navigationPath: ['posts', 'comments'],
                filter: nestedFilter,
            },
            {
                navigationProperty: 'profile',
                navigationPath: [],
            },
        ];

        expect(groupIncludes(includes)).toEqual([
            {
                navigationProperty: 'posts',
                directFilter,
                children: [{
                    navigationProperty: 'comments',
                    navigationPath: ['comments'],
                    filter: nestedFilter,
                }],
            },
            {
                navigationProperty: 'profile',
                directFilter: undefined,
                children: [],
            },
        ]);
    });

    it('deduplicates navigation entities by object identity', () => {
        const first = { id: 1 };
        const second = { id: 1 };
        const values: Record<string, unknown> = { posts: [first] };

        mergeNavigationItems(values, 'posts', [first, second, first]);
        expect(values.posts).toEqual([first, second]);
        expect(uniqueEntityInstances([first, second, first])).toEqual([
            first,
            second,
        ]);

        const pushed = [first];
        pushUnique(pushed, first);
        pushUnique(pushed, second);
        expect(pushed).toEqual([first, second]);
    });

    it('maintains unique object lists per stitch key', () => {
        const groups: Map<string, {
            readonly items: object[];
            readonly seen: Set<object>;
        }> = new Map();
        const first = { id: 1 };
        const second = { id: 1 };
        const list = getUniqueObjectList(groups, 'parent');

        pushUniqueObject(list, first);
        pushUniqueObject(list, first);
        pushUniqueObject(list, second);

        expect(getUniqueObjectList(groups, 'parent')).toBe(list);
        expect(list.items).toEqual([first, second]);
    });

    it('builds collision-safe keys and preserves the first unique tuple', () => {
        const first = ['a|b', 'c\\d'];
        const duplicate = ['a|b', 'c\\d'];
        const second = ['a', 'b|c'];

        expect(tupleLookupKey(first)).toBe(
            '["entitykit:identity:v1",["string","a|b"],["string","c\\\\d"]]',
        );
        expect(tupleLookupKey(first)).not.toBe(tupleLookupKey(second));
        expect(uniqueTuples([first, duplicate, second])).toEqual([first, second]);
        expect(uniqueValues([
            new Date('2026-01-01T00:00:00.000Z'),
            new Date('2026-01-01T00:00:00.000Z'),
            { id: 1 },
            { id: 1 },
        ])).toEqual([
            new Date('2026-01-01T00:00:00.000Z'),
            { id: 1 },
        ]);
        expect(lookupKey({ id: 1 })).toBe(
            '["entitykit:identity:v1",["object",["id",["number","1"]]]]',
        );
    });

    it('recognizes complete keys and applies provider reads before converters', () => {
        const metadata = {
            keyPropertiesMetadata: [{
                columnType: 'integer',
                converter: {
                    toProvider: (value: number) => value - 1,
                    fromProvider: (value: unknown) => Number(value) + 1,
                },
            }],
        } as unknown as EntityMetadata;
        const reader: StoreValueReader = {
            readValue: value => Number(value),
        };

        expect(isCompleteTuple(['tenant', 1])).toBe(true);
        expect(isCompleteTuple(['tenant', null])).toBe(false);
        expect(isCompleteTuple([undefined, 1])).toBe(false);
        expect(readKeyColumn(metadata, 0, '41', reader)).toBe(42);
    });
});
