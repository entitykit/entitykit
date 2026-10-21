import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import {
    type JoinTarget,
    type DatabaseOperationOptions,
    type ModelPropertySelector,
    type PropertyBuilder,
    type QueryStreamOptions,
    type Queryable,
} from '../packages/core/src';
import { createProjectionProxy, createQueryProxy } from '../packages/core/src/experimental';
// @ts-expect-error repository examples are not exported from the root package
import { AppDbContext as _RootExampleContext } from '../packages/core/src';
import { AppDbContext as _ExampleContext } from '../packages/core/src/examples';

class User {
    public id!: string;
    public email!: string;
    public createdAt!: Date;
    public posts!: Post[];
}

class Post {
    public id!: string;
    public authorId!: string | null;
    public title!: string;
    public viewCount!: number;
}

class Author {
    public id!: string;
    public email!: string;
}

class Order {
    public id!: string;
    public totalCents!: number;
    public customerEmail!: string;
    public paidAt!: Date | null;
    public createdAt!: Date;
}

type HasMember<TValue, TKey extends PropertyKey> =
    TKey extends keyof TValue ? true : false;

const model = new ModelBuilderImplementation();

model.entity(User, entity => {
    entity.toTable('users');
    entity.hasKey('id');
    entity.hasKey(user => user.id);
    entity.property('email').hasColumnName('email').hasColumnType('text').isRequired();

    const _emailProperty: PropertyBuilder<string> = entity.property(user => user.email);
    const _dateProperty: PropertyBuilder<Date> = entity.property(user => user.createdAt);

    // @ts-expect-error property name must be a key of User
    entity.property('doesNotExist');

    // @ts-expect-error key must be a key of User
    entity.hasKey('doesNotExist');

    const _selectorHasUnknownProperty: HasMember<
        ModelPropertySelector<User>,
        'doesNotExist'
    > = false;

    // @ts-expect-error selector must return a property token
    entity.property(() => 'email');
});

const queryUser = createQueryProxy<User>();
queryUser.email.eq('a@example.com');
queryUser.email.like('%@example.com');
queryUser.createdAt.gte(new Date());
queryUser.id.in(['usr_1', 'usr_2']);

// @ts-expect-error string fields cannot compare against numbers
queryUser.email.eq(123);

// Strings are comparable, matching EntityKit's comparison rules for
// min/max and what keyset pagination needs for its tiebreaker column.
queryUser.email.gt('z');
queryUser.id.lt('usr_9');

const _unsupportedQueryOperators: [
    HasMember<typeof queryUser.createdAt, 'like'>,
    HasMember<typeof queryUser.posts, 'gt'>,
] = [false, false];

// @ts-expect-error in values must match the field type
queryUser.id.in([123]);

const projectionUser = createProjectionProxy<User>();
const projection = { id: projectionUser.id, email: projectionUser.email, createdAt: projectionUser.createdAt };
const _projectedEmail: string | undefined = projection.email.__type;

const _projectionHasUnknownProperty: HasMember<typeof projectionUser, 'doesNotExist'> = false;

declare const posts: Queryable<Post>;
declare const users: Queryable<User>;
declare const authors: JoinTarget<Author>;
declare const orders: Queryable<Order>;

const streamOptions = {
    batchSize: 250,
    signal: new AbortController().signal,
} satisfies QueryStreamOptions;
const operationOptions = {
    signal: new AbortController().signal,
} satisfies DatabaseOperationOptions;
void posts.toArray(operationOptions);
void posts.count(operationOptions);
void posts.executeDelete(operationOptions);
const _entityStream: AsyncIterable<Post> = posts.stream(streamOptions);
const _projectionStream: AsyncIterable<{ title: string }> = posts
    .select(post => ({ title: post.title }))
    .stream(streamOptions);
const _joinedStream: AsyncIterable<{ authorEmail: string }> = posts
    .join('author', authors, ({ root, author }) => root.authorId.eq(author.id))
    .select(({ author }) => ({ authorEmail: author.email }))
    .stream(streamOptions);
const _aggregateStream: AsyncIterable<{ orderCount: number }> = orders
    .aggregate(aggregate => ({ orderCount: aggregate.count() }))
    .stream(streamOptions);

const _includedUsers = users.include(user => user.posts);
const _includedUsersHaveNoStream: HasMember<typeof _includedUsers, 'stream'> = false;

users
    .whereHas(user => user.posts, post => post.title.contains('launch'))
    .whereDoesNotHave(user => user.posts)
    .toPlan();

void posts
    .join('author', authors, ({ root, author }) => root.authorId.eq(author.id))
    .select(({ author }) => ({ authorEmail: author.email }))
    .toArray()
    .then(rows => {
        const _authorEmail: string = rows[0].authorEmail;
    });
void posts
    .select((post, project) => ({
        rowKind: project.literal('post'),
        priority: project.literal(1),
        visible: project.literal(true),
        title: post.title,
    }))
    .toArray()
    .then(rows => {
        const _rowKind: 'post' = rows[0].rowKind;
        const _priority: 1 = rows[0].priority;
        const _visible: true = rows[0].visible;
        const _title: string = rows[0].title;
    });

void posts
    .join('author', authors, ({ root, author }) => root.authorId.eq(author.id))
    .select(({ author }, project) => ({
        rowKind: project.literal('post-author'),
        authorEmail: author.email,
    }))
    .toArray()
    .then(rows => {
        const _rowKind: 'post-author' = rows[0].rowKind;
        const _authorEmail: string = rows[0].authorEmail;
    });

orders
    .aggregate(agg => ({
        orderCount: agg.count(),
        paidOrderCount: agg.count(order => order.paidAt),
        totalCents: agg.sum(order => order.totalCents),
        averageCents: agg.avg(order => order.totalCents),
        firstCustomerEmail: agg.min(order => order.customerEmail),
        latestOrderAt: agg.max(order => order.createdAt),
    }))
    .toPlan();

const _aggregateProjection = orders
    .aggregate(agg => ({
        orderCount: agg.count(),
        totalCents: agg.sum(order => order.totalCents),
        firstCustomerEmail: agg.min(order => order.customerEmail),
        latestOrderAt: agg.max(order => order.createdAt),
    }))
    .toPlan();

const _aggregateResult = orders.aggregate(agg => ({
    orderCount: agg.count(),
    totalCents: agg.sum(order => order.totalCents),
    firstCustomerEmail: agg.min(order => order.customerEmail),
    latestOrderAt: agg.max(order => order.createdAt),
}));

orders.aggregate(agg => {
    const _orderCount: number | undefined = agg.count().__type;
    const _totalCents: number | null | undefined = agg.sum(order => order.totalCents).__type;
    const _firstCustomerEmail: string | null | undefined = agg.min(order => order.customerEmail).__type;
    const _latestOrderAt: Date | null | undefined = agg.max(order => order.createdAt).__type;

    return { orderCount: agg.count() };
});

const _groupedAggregateResult = orders
    .groupBy(order => ({
        customerEmail: order.customerEmail,
        paidAt: order.paidAt,
    }))
    .select(group => ({
        customerEmail: group.key.customerEmail,
        paidAt: group.key.paidAt,
        orderCount: group.count(),
        totalCents: group.sum(order => order.totalCents),
    }));

orders
    .groupBy(order => ({ customerEmail: order.customerEmail }))
    .having(group => group.count().gte(2).and(group.key.customerEmail.contains('@example.com')))
    .select(group => {
        const _customerEmail: string | undefined = group.key.customerEmail.__type;
        const _totalCents: number | null | undefined = group.sum(order => order.totalCents).__type;

        const _groupHasUnselectedKey: HasMember<typeof group.key, 'paidAt'> = false;

        return {
            customerEmail: group.key.customerEmail,
            totalCents: group.sum(order => order.totalCents),
        };
    });

orders
    .groupBy(order => ({ customerEmail: order.customerEmail, paidAt: order.paidAt }))
    .having(group => group.sum(order => order.totalCents).gte(1000).and(group.key.paidAt.isNotNull()))
    .orderByDescending(group => group.sum(order => order.totalCents))
    .orderBy(group => group.key.customerEmail.asc())
    .skip(10)
    .take(5)
    .select(group => ({
        customerEmail: group.key.customerEmail,
        orderCount: group.count(),
    }));

orders
    .groupBy(order => ({ customerEmail: order.customerEmail }))
    .having(group => {
        const _unsupportedGroupOperators: [
            HasMember<ReturnType<typeof group.count>, 'contains'>,
            HasMember<typeof group.key.customerEmail, 'gte'>,
        ] = [false, false];

        return group.count().gte(1);
    })
// @ts-expect-error grouped orderBy selectors must return group keys or aggregate expressions
    .orderBy(_group => {
        return 'customerEmail';
    });

orders.aggregate(agg => ({
    // @ts-expect-error sum only supports numeric fields
    badTotal: agg.sum(order => order.customerEmail),
}));

orders.aggregate(agg => ({
    // @ts-expect-error avg only supports numeric fields
    badAverage: agg.avg(order => order.createdAt),
}));

void posts
    .leftJoin('author', authors, ({ root, author }) => root.authorId.eq(author.id))
    .select(({ author }) => ({ authorEmail: author.email }))
    .toArray()
    .then(rows => {
        const _authorEmail: string | null = rows[0].authorEmail;

        // @ts-expect-error left-joined projection fields are nullable
        const _nonNullableAuthorEmail: string = rows[0].authorEmail;
    });

void posts
    .join('author', authors, ({ root, author }) => root.authorId.eq(author.id))
    .aggregate(agg => ({
        postCount: agg.count(),
        authorCount: agg.count(({ author }) => author.id),
        totalViews: agg.sum(({ root }) => root.viewCount),
    }))
    .toArray()
    .then(rows => {
        const _postCount: number = rows[0].postCount;
        const _authorCount: number = rows[0].authorCount;
        const _totalViews: number | null = rows[0].totalViews;
    });

void posts
    .leftJoin('author', authors, ({ root, author }) => root.authorId.eq(author.id))
    .groupBy(({ author }) => ({ authorEmail: author.email }))
    .having(group => group.sum(({ root }) => root.viewCount).gte(10).and(group.key.authorEmail.isNotNull()))
    .orderByDescending(group => group.sum(({ root }) => root.viewCount))
    .select(group => ({
        authorEmail: group.key.authorEmail,
        postCount: group.count(),
        totalViews: group.sum(({ root }) => root.viewCount),
    }))
    .toArray()
    .then(rows => {
        const _authorEmail: string | null = rows[0].authorEmail;
        const _postCount: number = rows[0].postCount;
        const _totalViews: number | null = rows[0].totalViews;
    });
