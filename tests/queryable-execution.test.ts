import { Queryable } from '../packages/core/src/experimental';
import {
    createUserMetadata,
    RecordingExecutor,
    User,
} from './support/queryable-test-fixture';

describe('Queryable execution', () => {
    it('builds immutable query models', async () => {
        const executor = new RecordingExecutor();
        const metadata = createUserMetadata();
        const query = new Queryable(metadata, executor)
            .where(user => user.email.like('%@example.com'))
            .where(user => user.createdAt.gte(new Date('2026-01-01T00:00:00.000Z')))
            .orderByDescending(user => user.createdAt)
            .skip(10)
            .take(5);

        await query.toArray();

        expect(executor.models).toHaveLength(1);
        expect(executor.models[0]).toMatchObject({
            entityType: User,
            orderings: [{ propertyName: 'createdAt', direction: 'desc' }],
            offset: 10,
            limit: 5,
        });
        expect(executor.models[0]?.predicate?.node).toMatchObject({
            kind: 'logical',
            operator: 'and',
        });
    });

    it('supports first single count and exists terminal operations', async () => {
        const executor = new RecordingExecutor();
        const metadata = createUserMetadata();
        const user = new User();
        user.id = 'usr_1';
        user.email = 'a@example.com';
        user.createdAt = new Date();
        executor.rows = [user];
        executor.countValue = 1;
        executor.existsValue = true;

        const query = new Queryable(metadata, executor).where(u => u.id.eq('usr_1'));

        await expect(query.firstOrNull()).resolves.toBe(user);
        await expect(query.single()).resolves.toBe(user);
        await expect(query.count()).resolves.toBe(1);
        await expect(query.exists()).resolves.toBe(true);
    });

    it('uses single semantics for zero and multiple rows', async () => {
        const executor = new RecordingExecutor();
        const metadata = createUserMetadata();
        const query = new Queryable(metadata, executor);

        executor.rows = [];
        await expect(query.single()).rejects.toThrow('No \'User\' entity matched');

        executor.rows = [new User(), new User()];
        await expect(query.single()).rejects.toThrow('More than one \'User\' entity matched');
    });

    it('validates skip and take values', () => {
        const executor = new RecordingExecutor();
        const metadata = createUserMetadata();
        const query = new Queryable(metadata, executor);

        expect(() => query.skip(-1)).toThrow('skip count');
        expect(() => query.take(1.5)).toThrow('take count');
    });

    it('throws clear errors when predicate selectors return non-predicates', () => {
        const executor = new RecordingExecutor();
        const metadata = createUserMetadata();
        const query = new Queryable(metadata, executor);

        expect(() => query.where(user => user.email as never))
            .toThrow('where selectors must return a predicate expression');
        expect(() => query.select(user => ({ email: user.email })).where(user => user.email as never))
            .toThrow('where selectors must return a predicate expression');
        expect(() => query.include(user => user.posts.where(post => post.title as never)))
            .toThrow('include where selectors must return a predicate expression');
        expect(() => query.whereHas(user => user.posts, post => post.title as never))
            .toThrow('whereHas predicate selectors must return a predicate expression');
    });

    it('preserves explicit mixed and/or predicate grouping in SQL previews', () => {
        const executor = new RecordingExecutor();
        const metadata = createUserMetadata();
        const query = new Queryable(metadata, executor)
            .where(user => user.email.eq('a@example.com').or(user.email.eq('b@example.com')))
            .where(user => user.createdAt.gte(new Date('2026-01-01T00:00:00.000Z')));

        expect(query.toSql()).toEqual({
            text: 'select "id", "email", "created_at" from "users" where (("email" = $1 or "email" = $2) and "created_at" >= $3)',
            values: ['a@example.com', 'b@example.com', new Date('2026-01-01T00:00:00.000Z')],
        });
    });
});
