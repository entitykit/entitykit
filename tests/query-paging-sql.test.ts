import { RecordingDatabaseConnection } from './support/recording-database-connection';
import { createDb as createAggregateDb } from './aggregate-query-model/support';
import { createDb } from './joined-projection/support';
import { mySqlDialect } from '../src/providers/mysql/mysql-dialect';
import { sqliteDialect } from '../src/providers/sqlite/sqlite-dialect';

describe('compositional query paging SQL', () => {
    it('wraps paged projected count and exists as a parameterized sequence', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({ rows: [{ count: 3 }], rowCount: 1 });
        connection.queueResult({ rows: [{ exists: true }], rowCount: 1 });

        const query = db.posts
            .where(post => post.title.contains('EntityKit'))
            .skip(2)
            .take(3)
            .select(post => ({ postId: post.id }));

        await expect(query.count()).resolves.toBe(3);
        await expect(query.exists()).resolves.toBe(true);
        expect(connection.statements).toEqual([
            {
                text: 'select count(*) as "count" from (select 1 from "blog_posts" where "title" like $1 escape \'~\' limit $2 offset $3) "entitykit_page"',
                values: ['%EntityKit%', 3, 2],
            },
            {
                text: 'select exists(select 1 from (select 1 from "blog_posts" where "title" like $1 escape \'~\' limit $2 offset $3) "entitykit_page" limit 1) as "exists"',
                values: ['%EntityKit%', 3, 2],
            },
        ]);
    });

    it('wraps paged joined count and exists without widening the sequence', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({ rows: [{ count: 2 }], rowCount: 1 });
        connection.queueResult({ rows: [{ exists: false }], rowCount: 1 });

        const query = db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .where(({ author }) => author.status.eq('active'))
            .skip(1)
            .take(2)
            .select(({ root }) => ({ postId: root.id }));

        await expect(query.count()).resolves.toBe(2);
        await expect(query.exists()).resolves.toBe(false);
        expect(connection.statements).toEqual([
            {
                text: 'select count(*) as "count" from (select 1 from "blog_posts" "root" inner join "authors" "author" on "root"."author_id" = "author"."id" where "author"."status" = $1 limit $2 offset $3) "entitykit_page"',
                values: ['active', 2, 1],
            },
            {
                text: 'select exists(select 1 from (select 1 from "blog_posts" "root" inner join "authors" "author" on "root"."author_id" = "author"."id" where "author"."status" = $1 limit $2 offset $3) "entitykit_page" limit 1) as "exists"',
                values: ['active', 2, 1],
            },
        ]);
    });

    it.each([
        [
            'SQLite',
            sqliteDialect,
            'select count(*) as "count" from (select 1 from "blog_posts" limit -1 offset ?) "entitykit_page"',
        ],
        [
            'MySQL',
            mySqlDialect,
            'select count(*) as `count` from (select 1 from `blog_posts` limit 18446744073709551615 offset ?) `entitykit_page`',
        ],
    ])('renders offset-only paging for %s', async (_name, dialect, text) => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection, dialect);
        connection.queueResult({ rows: [{ count: 0 }], rowCount: 1 });

        await expect(db.posts.skip(4).count()).resolves.toBe(0);
        expect(connection.statements).toEqual([{
            text,
            values: [4],
        }]);
    });

    it('keeps entity, projected, and joined terminal limits below an existing take', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({ rows: [], rowCount: 0 });
        connection.queueResult({ rows: [{ postId: 'post_1' }], rowCount: 1 });
        connection.queueResult({ rows: [{ postId: 'post_1' }], rowCount: 1 });

        await expect(db.posts.take(0).firstOrNull()).resolves.toBeNull();
        await expect(db.posts
            .take(1)
            .select(post => ({ postId: post.id }))
            .single()).resolves.toEqual({ postId: 'post_1' });
        await expect(db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .take(1)
            .select(({ root }) => ({ postId: root.id }))
            .single()).resolves.toEqual({ postId: 'post_1' });

        expect(connection.statements.map(statement => statement.values)).toEqual([
            [0],
            [1],
            [1],
        ]);
    });

    it('caps grouped terminals but leaves the single-row aggregate shape unpaged', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createAggregateDb(connection);
        connection.queueResult({ rows: [{ customerEmail: 'a@example.com', orderCount: '2' }], rowCount: 1 });
        connection.queueResult({ rows: [{ orderCount: '3' }], rowCount: 1 });

        await expect(db.orders
            .groupBy(order => ({ customerEmail: order.customerEmail }))
            .select(group => ({
                customerEmail: group.key.customerEmail,
                orderCount: group.count(),
            }))
            .firstOrNull()).resolves.toEqual({
            customerEmail: 'a@example.com',
            orderCount: 2,
        });
        await expect(db.orders
            .aggregate(aggregate => ({ orderCount: aggregate.count() }))
            .firstOrNull()).resolves.toEqual({ orderCount: 3 });

        expect(connection.statements.map(statement => statement.values)).toEqual([
            ['wrk_1', 1],
            ['wrk_1'],
        ]);
        expect(connection.statements[0]?.text).toContain('limit $2');
        expect(connection.statements[1]?.text).not.toContain('limit');
    });
});
