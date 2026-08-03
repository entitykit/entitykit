import { Queryable } from '../../src/experimental';
import { SelectSqlBuilder } from '../../src/sql/select-sql-builder';
import { Post, RelationExecutor, Role, User, createBlogModel } from './support';

describe('SelectSqlBuilder relation existence', () => {
    it('compiles one-to-many relation existence filters without duplicate root joins', () => {
        const model = createBlogModel();
        const metadata = model.getEntity(User);
        const query = new Queryable(metadata, new RelationExecutor(metadata))
            .whereHas(user => user.posts)
            .orderBy(user => user.email)
            .take(5)
            .toQueryModel();

        expect(new SelectSqlBuilder().build(metadata, query)).toEqual({
            text: 'select "root"."id", "root"."email", "root"."display_name", "root"."created_at", "root"."deleted_at" from "users" "root" where exists(select 1 from "posts" "rel" where "rel"."author_id" = "root"."id") order by "root"."email" asc limit $1',
            values: [5],
        });
        expect(new SelectSqlBuilder().buildCount(metadata, query)).toEqual({
            text: 'select count(*) as "count" from (select 1 from "users" "root" where exists(select 1 from "posts" "rel" where "rel"."author_id" = "root"."id") limit $1) "entitykit_page"',
            values: [5],
        });
    });

    it('compiles filtered one-to-many anti-existence filters', () => {
        const model = createBlogModel();
        const metadata = model.getEntity(User);
        const query = new Queryable(metadata, new RelationExecutor(metadata))
            .where(user => user.email.endsWith('@example.com'))
            .whereDoesNotHave(user => user.posts, post => post.title.contains('draft'))
            .toQueryModel();

        expect(new SelectSqlBuilder().build(metadata, query)).toEqual({
            text: 'select "root"."id", "root"."email", "root"."display_name", "root"."created_at", "root"."deleted_at" from "users" "root" where "root"."email" like $1 escape \'~\' and not exists(select 1 from "posts" "rel" where "rel"."author_id" = "root"."id" and "rel"."title" like $2 escape \'~\')',
            values: ['%@example.com', '%draft%'],
        });
    });

    it('compiles many-to-one relation existence filters', () => {
        const model = createBlogModel();
        const metadata = model.getEntity(Post);
        const query = new Queryable(metadata, new RelationExecutor(metadata))
            .whereHas(post => post.author, author => author.email.eq('a@example.com'))
            .toQueryModel();

        expect(new SelectSqlBuilder().buildExists(metadata, query)).toEqual({
            text: 'select exists(select 1 from "posts" "root" where exists(select 1 from "users" "rel" where "rel"."id" = "root"."author_id" and "rel"."email" = $1) limit 1) as "exists"',
            values: ['a@example.com'],
        });
    });

    it('compiles direct many-to-many relation existence filters through the join table', () => {
        const model = createBlogModel();
        const metadata = model.getEntity(User);
        const query = new Queryable(metadata, new RelationExecutor(metadata))
            .whereHas(user => user.roles, role => role.name.eq('admin'))
            .toQueryModel();

        expect(new SelectSqlBuilder().build(metadata, query)).toEqual({
            text: 'select "root"."id", "root"."email", "root"."display_name", "root"."created_at", "root"."deleted_at" from "users" "root" where exists(select 1 from "user_roles" "rel_join" join "roles" "rel" on "rel_join"."role_id" = "rel"."id" where "rel_join"."user_id" = "root"."id" and "rel"."name" = $1)',
            values: ['admin'],
        });
    });

    it('compiles inverse many-to-many anti-existence filters through the join table', () => {
        const model = createBlogModel();
        const metadata = model.getEntity(Role);
        const query = new Queryable(metadata, new RelationExecutor(metadata))
            .whereDoesNotHave(role => role.users, user => user.email.endsWith('@example.com'))
            .toQueryModel();

        expect(new SelectSqlBuilder().buildCount(metadata, query)).toEqual({
            text: 'select count(*) as "count" from "roles" "root" where not exists(select 1 from "user_roles" "rel_join" join "users" "rel" on "rel_join"."user_id" = "rel"."id" where "rel_join"."role_id" = "root"."id" and "rel"."email" like $1 escape \'~\')',
            values: ['%@example.com'],
        });
    });

    it('compiles relation-existence filters in an ungrouped aggregate query', () => {
        const model = createBlogModel();
        const metadata = model.getEntity(User);
        const query = new Queryable(metadata, new RelationExecutor(metadata))
            .whereHas(user => user.posts)
            .aggregate(agg => ({ userCount: agg.count() }))
            .toQueryModel();

        const statement = new SelectSqlBuilder().buildAggregate(metadata, query);
        expect(statement.text).toContain('from "users" "root"');
        expect(statement.text).toContain('where exists(select 1 from "posts" "rel" where "rel"."author_id" = "root"."id")');
    });

    it('compiles relation-existence filters in a grouped aggregate query', () => {
        const model = createBlogModel();
        const metadata = model.getEntity(User);
        const query = new Queryable(metadata, new RelationExecutor(metadata))
            .whereDoesNotHave(user => user.posts, post => post.title.contains('draft'))
            .groupBy(user => ({ email: user.email }))
            .select(group => ({ email: group.key.email, total: group.count() }))
            .toQueryModel();

        const statement = new SelectSqlBuilder().buildAggregate(metadata, query);
        expect(statement.text).toContain('from "users" "root"');
        expect(statement.text).toContain('group by "root"."email"');
        expect(statement.text).toContain('not exists(select 1 from "posts" "rel" where "rel"."author_id" = "root"."id" and "rel"."title" like');
    });

    it('compiles relation-existence filters on a joined projection query', () => {
        const model = createBlogModel();
        const userMetadata = model.getEntity(User);
        const postMetadata = model.getEntity(Post);
        const query = new Queryable(userMetadata, new RelationExecutor(userMetadata))
            .whereHas(user => user.roles, role => role.name.eq('admin'))
            .join('post', { metadata: postMetadata }, ({ root, post }) => post.authorId.eq(root.id))
            .select(({ root, post }) => ({ email: root.email, title: post.title }))
            .toQueryModel();

        const statement = new SelectSqlBuilder().build(userMetadata, query);
        expect(statement.text).toContain('inner join "posts" "post" on "post"."author_id" = "root"."id"');
        expect(statement.text).toContain('where exists(select 1 from "user_roles" "rel_join" join "roles" "rel" on "rel_join"."role_id" = "rel"."id" where "rel_join"."user_id" = "root"."id" and "rel"."name" = $1)');
    });

    it('compiles null-aware membership on joined sources', () => {
        const model = createBlogModel();
        const userMetadata = model.getEntity(User);
        const postMetadata = model.getEntity(Post);
        const deletedAt = new Date('2026-01-01T00:00:00.000Z');
        const query = new Queryable(userMetadata, new RelationExecutor(userMetadata))
            .join('post', { metadata: postMetadata }, ({ root, post }) => post.authorId.eq(root.id))
            .where(({ root }) => root.deletedAt.in([deletedAt, null]))
            .select(({ root }) => ({ email: root.email }))
            .toQueryModel();

        expect(new SelectSqlBuilder().build(userMetadata, query)).toEqual({
            text: 'select "root"."email" as "email" from "users" "root" inner join "posts" "post" on "post"."author_id" = "root"."id" where ("root"."deleted_at" in ($1) or "root"."deleted_at" is null)',
            values: [deletedAt],
        });
    });
});
