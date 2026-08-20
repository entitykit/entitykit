import { Queryable } from '../packages/core/src/experimental';
import { buildSelectSqlCacheKey } from '../packages/core/src/sql/select-sql-builder';
import {
    createUserMetadata,
    RecordingExecutor,
} from './support/queryable-test-fixture';

describe('Queryable projection and includes', () => {
    it('throws path-aware errors for invalid projection shapes', () => {
        const executor = new RecordingExecutor();
        const metadata = createUserMetadata();
        const query = new Queryable(metadata, executor);

        expect(() => query.select(() => ({ nested: { email: 'a@example.com' } }) as never))
            .toThrow('Projection path \'nested.email\' must select a mapped field, literal, SQL expression, or plain nested object.');
        expect(() => query.select(() => ({}) as never))
            .toThrow('Projection selectors must select at least one value.');
    });

    it('includes literal projection shape in SQL cache keys without literal values', () => {
        const executor = new RecordingExecutor();
        const metadata = createUserMetadata();
        const userKind = buildSelectSqlCacheKey(metadata, new Queryable(metadata, executor)
            .select((user, project) => ({
                kind: project.literal('member-row'),
                email: user.email,
            }))
            .toQueryModel());
        const adminKind = buildSelectSqlCacheKey(metadata, new Queryable(metadata, executor)
            .select((user, project) => ({
                kind: project.literal('owner-row'),
                email: user.email,
            }))
            .toQueryModel());
        const numericKind = buildSelectSqlCacheKey(metadata, new Queryable(metadata, executor)
            .select((user, project) => ({
                kind: project.literal(1),
                email: user.email,
            }))
            .toQueryModel());

        expect(userKind).toBe(adminKind);
        expect(userKind).not.toBe(numericKind);
        expect(userKind).toContain('"valueShape":"string"');
        expect(userKind).not.toContain('member-row');
        expect(adminKind).not.toContain('owner-row');
    });

    it('replaces repeated includes for the same navigation path', async () => {
        const executor = new RecordingExecutor();
        const metadata = createUserMetadata();
        const query = new Queryable(metadata, executor)
            .include(user => user.posts.where(post => post.title.like('old%')).take(1))
            .include(user => user.posts.where(post => post.title.like('new%')).take(2));

        await query.toArray();

        expect(executor.models).toHaveLength(1);
        expect(executor.models[0]?.includes).toHaveLength(1);
        expect(executor.models[0]?.includes[0]).toMatchObject({
            navigationPath: ['posts'],
            filter: {
                limit: 2,
            },
        });
        expect(JSON.stringify(executor.models[0]?.includes[0]?.filter?.predicate?.node)).toContain('new%');
        expect(JSON.stringify(executor.models[0]?.includes[0]?.filter?.predicate?.node)).not.toContain('old%');
    });

    it('preserves projected query chaining across terminal operations', async () => {
        const executor = new RecordingExecutor();
        executor.projectionRows = [{ email: 'a@example.com' }];
        executor.countValue = 7;
        executor.existsValue = true;
        const metadata = createUserMetadata();
        const query = new Queryable(metadata, executor)
            .where(user => user.email.like('%@example.com'))
            .select(user => ({ email: user.email }))
            .whereIf(false, user => user.id.eq('ignored'))
            .orderByDescending(user => user.createdAt)
            .skip(2)
            .take(3);

        await expect(query.toArray()).resolves.toEqual([{ email: 'a@example.com' }]);
        await expect(query.count()).resolves.toBe(7);
        await expect(query.exists()).resolves.toBe(true);

        expect(executor.models).toHaveLength(3);
        for (const model of executor.models) {
            expect(model).toMatchObject({
                orderings: [{ propertyName: 'createdAt', direction: 'desc' }],
                offset: 2,
                limit: 3,
                projection: [{ alias: 'email', propertyName: 'email' }],
            });
            expect(JSON.stringify(model.predicate?.node)).toContain('"propertyName":"email"');
            expect(JSON.stringify(model.predicate?.node)).not.toContain('ignored');
        }
    });
});
