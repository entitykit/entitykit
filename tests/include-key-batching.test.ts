import { openCompositeIncludeGraph, openWindowIncludeGraph } from './support/include-batching-context';

const scores = Array.from({ length: 80 }, (_, index) => index);

describe('include key batching on populated SQLite graphs', () => {
    it('rounds a partial composite tuple budget down without losing either key part', async () => {
        const db = await openCompositeIncludeGraph(7, 5);
        const queries = jest.spyOn(db.database.connection, 'query');
        try {
            const children = await db.compositeChildren.include(row => row.parent).toArray();
            expect(children).toHaveLength(7);
            expect(children.every(child => child.parent?.scope === child.parentScope && child.parent.id === child.parentId)).toBe(true);
            expect(queries).toHaveBeenCalledTimes(5);
            expect(queries.mock.calls.every(([statement]) => statement.values.length <= 5)).toBe(true);
        } finally {
            queries.mockRestore();
            await db.dispose();
        }
    });
    it.each([1_000, 5_000])('loads %i composite references without deep expressions', async count => {
        const db = await openCompositeIncludeGraph(count);
        const queries = jest.spyOn(db.database.connection, 'query');
        try {
            const children = await db.compositeChildren.include(row => row.parent).toArray();
            expect(children).toHaveLength(count);
            expect(children.every(child => child.parent?.scope === child.parentScope
                && child.parent.id === child.parentId && child.parent.children.includes(child))).toBe(true);
            expect(queries).toHaveBeenCalledTimes(1 + Math.ceil(count / 256));
        } finally {
            queries.mockRestore(); await db.dispose();
        }
    });

    it('stitches populated composite collections across key batches', async () => {
        const db = await openCompositeIncludeGraph(1_000);
        try {
            const parents = await db.compositeParents.include(row => row.children).toArray();
            expect(parents).toHaveLength(1_000);
            expect(parents.every(parent => parent.children.length === 1
                && parent.children[0]?.parent === parent
                && parent.children[0].parentId === parent.id
                && parent.children[0].parentScope === parent.scope)).toBe(true);
        } finally {
            await db.dispose();
        }
    });

    it('applies a many-to-many filter to every composite key and retains the complete inverse', async () => {
        const db = await openCompositeIncludeGraph(1_000);
        const queries = jest.spyOn(db.database.connection, 'query');
        try {
            const parents = await db.compositeParents.include(row => row.labels.where(label => label.rank.eq(1))).toArray();
            expect(parents).toHaveLength(1_000);
            expect(parents.every(parent => parent.labels.length === 1 && parent.labels[0]?.id === 2)).toBe(true);
            expect(new Set(parents[0]?.labels[0]?.parents)).toEqual(new Set(parents));
            expect(queries).toHaveBeenCalledTimes(5);
        } finally {
            queries.mockRestore(); await db.dispose();
        }
    });

    it.each(['collection', 'many-to-many', 'collection-window', 'many-to-many-window'])(
        'counts wide filters, tenant scope and window parameters for %s', async kind => {
            const db = await openWindowIncludeGraph();
            const queries = jest.spyOn(db.database.connection, 'query');
            try {
                const query = kind === 'collection'
                    ? db.parents.include(row => row.children.where(child => child.score.in(scores)).orderBy(child => child.score))
                    : kind === 'many-to-many'
                        ? db.parents.include(row => row.tags.where(tag => tag.score.in(scores)).orderBy(tag => tag.score))
                        : kind === 'collection-window'
                            ? db.parents.include(row => row.children.where(child => child.score.in(scores)).orderBy(child => child.score).skip(1).take(2))
                            : db.parents.include(row => row.tags.where(tag => tag.score.in(scores)).orderBy(tag => tag.score).skip(1).take(2));
                const parents = await query.toArray();
                const expected = kind.endsWith('window') ? [1, 2] : [0, 1, 2, 3];
                expect(parents).toHaveLength(33);
                for (const parent of parents) {
                    const rows = kind.startsWith('collection') ? parent.children : parent.tags;
                    expect(rows.map(row => row.score)).toEqual(expected);
                    expect(rows.every(row => row.workspaceId === 1)).toBe(true);
                }
                expect(queries).toHaveBeenCalledTimes(4);
                expect(queries.mock.calls.every(([statement]) => statement.values.length <= 96)).toBe(true);
                if (kind.startsWith('many-to-many')) {
                    expect(new Set(parents[0]?.tags[0]?.parents)).toEqual(new Set(parents));
                }
            } finally {
                queries.mockRestore(); await db.dispose();
            }
        });
});
