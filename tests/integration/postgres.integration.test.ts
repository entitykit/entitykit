import { EntityState } from '../../packages/core/src';
import { AppDbContext, Post, User } from '../../packages/core/src/examples';

const shouldRunPostgresTests = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const describePostgres = shouldRunPostgresTests ? describe : describe.skip;

describePostgres('Postgres integration', () => {
    let db: AppDbContext;

    beforeEach(async () => {
        db =  AppDbContext.create();
        await db.database.connection.query({ text: 'drop table if exists "posts" cascade; drop table if exists "users" cascade;', values: [] });
        await db.database.connection.query({ text: db.database.createScript(), values: [] });
    });

    afterEach(async () => {
        await db.dispose();
    });

    it('runs the full query, track, mutate, add, and transactional save workflow', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');

        db.users.add(new User({
            id: 'usr_1',
            email: 'ada@example.com',
            name: 'Ada',
            createdAt: now,
            updatedAt: now,
        }));

        await db.saveChanges();
        db.changeTracker.clear();

        const user = await db.users
            .where(u => u.email.eq('ada@example.com'))
            .single();

        expect(user).toBeInstanceOf(User);
        expect(db.entry(user)?.state).toBe(EntityState.Unchanged);

        user.name = 'Ada Lovelace';
        db.posts.add(new Post({
            id: 'post_1',
            title: 'Entity Framework but TypeScript',
            authorId: user.id,
            createdAt: now,
            updatedAt: now,
        }));

        expect(db.getSavePlan()).toHaveLength(2);
        await db.saveChanges();

        const userRow = await db.database.connection.query<{ name: string }>({
            text: 'select "name" from "users" where "id" = $1',
            values: ['usr_1'],
        });
        const postRow = await db.database.connection.query<{ title: string; author_id: string }>({
            text: 'select "title", "author_id" from "posts" where "id" = $1',
            values: ['post_1'],
        });

        expect(userRow.rows[0]).toEqual({ name: 'Ada Lovelace' });
        expect(postRow.rows[0]).toEqual({ title: 'Entity Framework but TypeScript', author_id: 'usr_1' });
        expect(db.changeTracker.entries().every(entry => entry.state === EntityState.Unchanged)).toBe(true);
    });
});
