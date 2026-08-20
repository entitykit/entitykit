import { type RelationNavigationProxy } from '../packages/core/src';
import { Queryable } from '../packages/core/src/experimental';
import { buildSelectSqlCacheKey } from '../packages/core/src/sql/select-sql-builder';
import type {
    User,
} from './support/queryable-test-fixture';
import {
    createUserMetadata,
    RecordingExecutor,
} from './support/queryable-test-fixture';

describe('Queryable relation existence', () => {
    it('records duplicate-safe relation existence predicates in query models', () => {
        const executor = new RecordingExecutor();
        const metadata = createUserMetadata();
        const query = new Queryable(metadata, executor)
            .whereHas(user => user.posts, post => post.title.contains('launch'))
            .whereDoesNotHave(user => user.posts)
            .whereHas(user => user.posts, post => post.id.eq('post_1'));

        expect(query.toQueryModel().relationExistence).toHaveLength(3);
        expect(query.toQueryModel().relationExistence.map(expression => expression.operator)).toEqual([
            'exists',
            'notExists',
            'exists',
        ]);
        expect(query.toQueryModel().relationExistence.map(expression => expression.relation.kind)).toEqual([
            'oneToMany',
            'oneToMany',
            'oneToMany',
        ]);
        expect(query.toQueryModel().relationExistence[0]?.predicate?.node).toMatchObject({
            kind: 'binary',
            operator: 'contains',
            propertyName: 'title',
        });
    });

    it('validates relation existence selectors', () => {
        const executor = new RecordingExecutor();
        const metadata = createUserMetadata();
        const query = new Queryable(metadata, executor);

        expect(() => query.whereHas(() => 'posts' as never))
            .toThrow('whereHas selectors must return a direct navigation property access');
        expect(() => query.whereHas(user => user.email as never))
            .toThrow('Relation \'email\' is not configured on entity \'User\'');
        expect(() => query.whereDoesNotHave(user => (user as RelationNavigationProxy<User> & { missing: never }).missing))
            .toThrow('Relation \'missing\' is not configured on entity \'User\'');
    });

    it('includes relation existence shape in SQL cache keys without literal values', () => {
        const executor = new RecordingExecutor();
        const metadata = createUserMetadata();
        const launchKey = buildSelectSqlCacheKey(metadata, new Queryable(metadata, executor)
            .whereHas(user => user.posts, post => post.title.contains('launch'))
            .toQueryModel());
        const pricingKey = buildSelectSqlCacheKey(metadata, new Queryable(metadata, executor)
            .whereHas(user => user.posts, post => post.title.contains('pricing'))
            .toQueryModel());
        const noneKey = buildSelectSqlCacheKey(metadata, new Queryable(metadata, executor)
            .whereDoesNotHave(user => user.posts, post => post.title.contains('launch'))
            .toQueryModel());

        expect(launchKey).toBe(pricingKey);
        expect(launchKey).not.toBe(noneKey);
        expect(launchKey).toContain('"relationKind":"oneToMany"');
        expect(launchKey).not.toContain('launch');
        expect(pricingKey).not.toContain('pricing');
    });

    it('previews one-to-many relation existence SQL', () => {
        const executor = new RecordingExecutor();
        const metadata = createUserMetadata();
        const query = new Queryable(metadata, executor)
            .whereHas(user => user.posts, post => post.title.contains('launch'));

        expect(query.toSql()).toEqual({
            text: 'select "root"."id", "root"."email", "root"."created_at" from "users" "root" where exists(select 1 from "posts" "rel" where "rel"."author_id" = "root"."id" and "rel"."title" like $1 escape \'~\')',
            values: ['%launch%'],
        });
    });
});
