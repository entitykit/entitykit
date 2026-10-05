import type { ModelBuilder } from '../packages/core/src';
import { Child, IncludeBatchingContext, Tag, openWindowIncludeGraph } from './support/include-batching-context';

class ConvertedIncludeContext extends IncludeBatchingContext {
    public readonly bindScore = jest.fn((value: number) => value + 100);

    protected override model(model: ModelBuilder): void {
        super.model(model);
        for (const type of [Child, Tag]) model.entity<Child | Tag>(type, entity => {
            entity.property(row => row.score).hasConversion({
                toProvider: value => this.bindScore(value), fromProvider: (value: number) => value - 100,
            });
        });
    }
}

describe('fixed include filter conversions', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each(['collection', 'many-to-many', 'collection-window', 'many-to-many-window'])(
        'binds an 80-value %s filter once before submitting its first chunk', async kind => {
            const db = ConvertedIncludeContext.create(96);
            await openWindowIncludeGraph(db);
            try {
                for (const table of ['batch_children', 'batch_tags']) await db.database.connection.query({
                    text: `update ${table} set score = score + 100`, values: [],
                });
                const callsBeforeChunks: number[] = [];
                const query = db.database.connection.query.bind(db.database.connection);
                jest.spyOn(db.database.connection, 'query').mockImplementation(async (statement, options) => {
                    if (/^select /i.test(statement.text) && /batch_children|batch_tags/.test(statement.text)) {
                        callsBeforeChunks.push(db.bindScore.mock.calls.length);
                        expect(statement.values.length).toBeLessThanOrEqual(96);
                        expect(statement.values).toEqual(expect.arrayContaining(Array.from({ length: 80 }, (_, index) => index + 100)));
                    }
                    return query(statement, options);
                });
                const scores = Array.from({ length: 80 }, (_, index) => index);
                const roots = kind === 'collection'
                    ? db.parents.include(row => row.children.where(child => child.score.in(scores)).orderBy(child => child.score))
                    : kind === 'many-to-many'
                        ? db.parents.include(row => row.tags.where(tag => tag.score.in(scores)).orderBy(tag => tag.score))
                        : kind === 'collection-window'
                            ? db.parents.include(row => row.children.where(child => child.score.in(scores)).orderBy(child => child.score).skip(1).take(2))
                            : db.parents.include(row => row.tags.where(tag => tag.score.in(scores)).orderBy(tag => tag.score).skip(1).take(2));
                const parents = await roots.toArray();
                expect(callsBeforeChunks).toHaveLength(3);
                expect(callsBeforeChunks[0]).toBe(80);
                for (const parent of parents) {
                    const rows = kind.startsWith('collection') ? parent.children : parent.tags;
                    expect(rows.map(row => row.score)).toEqual(kind.endsWith('window') ? [1, 2] : [0, 1, 2, 3]);
                    expect(rows.every(row => row.workspaceId === 1)).toBe(true);
                }
            } finally {
                await db.dispose();
            }
        });
});
