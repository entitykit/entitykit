import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import {
    ForeignKeyConstraintError,
} from '../src';
import { SchemaSqlBuilder } from '../src/schema/schema-sql-builder';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import { internalEntityEntry } from './support/public-api-internals';
import { createPostgresProviderError } from '../src/providers/postgres/postgres-provider-error';
import {
    configureRelationshipModel,
    createRelationshipDb as createDb,
    NoActionPost,
    OptionalPost,
    RequiredPost,
    RestrictPost,
    User,
} from './support/relationship-model';

describe('relationship semantics', () => {
    it('validates required foreign-key values before saveChanges reaches the provider', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        db.requiredPosts.add(new RequiredPost({ id: 'post_1', title: 'Missing author', authorId: null }));

        await expect(db.saveChanges()).rejects.toMatchObject({
            name: 'DbValidationError',
            message: 'Required property \'RequiredPost.authorId\' must have a value.',
        });
        expect(connection.statements).toEqual([]);
        expect(connection.transactionEvents).toEqual([]);
    });

    it('lets the provider enforce missing principals and maps the foreign-key error', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        db.requiredPosts.add(new RequiredPost({ id: 'post_1', title: 'Missing author', authorId: 'missing' }));
        connection.queueError(createPostgresProviderError('query', {
            code: '23503',
            constraint: 'fk_required_posts_users_author_id',
        }));

        await expect(db.saveChanges()).rejects.toBeInstanceOf(ForeignKeyConstraintError);
        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(connection.statements).toEqual([{
            text: 'insert into "required_posts" ("id", "title", "author_id") values ($1, $2, $3)',
            values: ['post_1', 'Missing author', 'missing'],
        }]);
    });

    it('updates relationships through scalar foreign-key changes', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const originalAuthor = new User({ id: 'usr_1' });
        const nextAuthor = new User({ id: 'usr_2' });
        const post = new RequiredPost({
            id: 'post_1',
            title: 'Moved',
            authorId: originalAuthor.id,
            author: originalAuthor,
        });
        db.requiredPosts.attach(post);
        post.authorId = nextAuthor.id;
        post.author = nextAuthor;
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(connection.statements).toEqual([{
            text: 'update "required_posts" set "author_id" = $1 where "id" = $2',
            values: ['usr_2', 'post_1'],
        }]);
    });

    it('synchronizes a foreign key from reference navigation assignment', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const originalAuthor = new User({ id: 'usr_1' });
        const nextAuthor = new User({ id: 'usr_2' });
        const post = new RequiredPost({
            id: 'post_1',
            title: 'Navigation only',
            authorId: originalAuthor.id,
            author: originalAuthor,
        });
        db.requiredPosts.attach(post);
        post.author = nextAuthor;
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(post.authorId).toBe('usr_2');
        expect(connection.statements).toEqual([{
            text: 'update "required_posts" set "author_id" = $1 where "id" = $2',
            values: ['usr_2', 'post_1'],
        }]);
    });

    it('clears optional relationships through nullable scalar foreign keys', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const author = new User({ id: 'usr_1' });
        const post = new OptionalPost();
        post.id = 'post_1';
        post.authorId = author.id;
        post.author = author;
        db.optionalPosts.attach(post);
        post.authorId = null;
        post.author = null;
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(connection.statements).toEqual([{
            text: 'update "optional_posts" set "author_id" = $1 where "id" = $2',
            values: [null, 'post_1'],
        }]);
    });

    it('fixes references and inverse collections from scalar foreign-key changes', () => {
        const db = createDb();
        const originalAuthor = new User({ id: 'usr_1', cascadePosts: [] });
        const nextAuthor = new User({ id: 'usr_2', cascadePosts: [] });
        const post = new RequiredPost({
            id: 'post_1',
            title: 'Moved',
            authorId: originalAuthor.id,
            author: originalAuthor,
        });
        originalAuthor.cascadePosts.push(post);
        db.users.attach(originalAuthor);
        db.users.attach(nextAuthor);
        db.requiredPosts.attach(post);

        post.authorId = nextAuthor.id;
        db.changeTracker.detectChanges();

        expect(post.author).toBe(nextAuthor);
        expect(originalAuthor.cascadePosts).toEqual([]);
        expect(nextAuthor.cascadePosts).toEqual([post]);
    });

    it('fixes dependent references from known collection additions', () => {
        const db = createDb();
        const previous = new User({ id: 'usr_old' });
        const user = new User({ id: 'usr_1', cascadePosts: [] });
        const post = new RequiredPost({
            id: 'post_1',
            title: 'Move from collection',
            authorId: previous.id,
            author: previous,
        });
        db.users.attach(user);
        db.requiredPosts.attach(post);

        user.cascadePosts.push(post);
        db.changeTracker.detectChanges();

        expect(post.author).toBe(user);
        expect(post.authorId).toBe('usr_1');
        expect(db.entry(post)?.state).toBe('Modified');
    });

    it('does not infer orphans from a collection that was never loaded', () => {
        const db = createDb();
        const user = new User({ id: 'usr_1' });
        const post = new RequiredPost({
            id: 'post_1',
            title: 'Still related',
            authorId: user.id,
            author: user,
        });
        db.users.attach(user);
        db.requiredPosts.attach(post);

        user.cascadePosts = [];
        db.changeTracker.detectChanges();

        expect(db.entry(post)?.state).toBe('Unchanged');
        expect(post.author).toBe(user);
        expect(post.authorId).toBe(user.id);
    });

    it('stops inferring orphans after a navigation is marked not loaded', () => {
        const db = createDb();
        const user = new User({ id: 'usr_1', cascadePosts: [] });
        const post = new RequiredPost({
            id: 'post_1',
            title: 'Partial graph',
            authorId: user.id,
            author: user,
        });
        user.cascadePosts.push(post);
        const userEntry = db.users.attach(user);
        db.requiredPosts.attach(post);
        internalEntityEntry(userEntry).markNavigationNotLoaded('cascadePosts');

        user.cascadePosts.splice(0, 1);
        db.changeTracker.detectChanges();

        expect(db.entry(post)?.state).toBe('Unchanged');
    });

    it('cascades principal deletion to dependents already tracked in memory', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const user = new User({ id: 'usr_1', cascadePosts: [] });
        const post = new RequiredPost({
            id: 'post_1',
            title: 'Cascade me',
            authorId: user.id,
            author: user,
        });
        user.cascadePosts.push(post);
        db.users.attach(user);
        db.requiredPosts.attach(post);
        db.users.remove(user);
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(connection.statements).toEqual([
            {
                text: 'delete from "required_posts" where "id" = $1',
                values: ['post_1'],
            },
            {
                text: 'delete from "users" where "id" = $1',
                values: ['usr_1'],
            },
        ]);
    });

    it('deletes required orphans removed from a known collection', () => {
        const db = createDb();
        const user = new User({ id: 'usr_1', cascadePosts: [] });
        const post = new RequiredPost({
            id: 'post_1',
            title: 'Orphan',
            authorId: user.id,
            author: user,
        });
        user.cascadePosts.push(post);
        db.users.attach(user);
        db.requiredPosts.attach(post);

        user.cascadePosts.splice(0, 1);
        db.changeTracker.detectChanges();

        expect(db.entry(post)?.state).toBe('Deleted');
        expect(post.author).toBeNull();
    });

    it('nulls optional dependents removed from a known collection', () => {
        const db = createDb();
        const user = new User({ id: 'usr_1', optionalPosts: [] });
        const post = new OptionalPost();
        post.id = 'post_1';
        post.authorId = user.id;
        post.author = user;
        user.optionalPosts.push(post);
        db.users.attach(user);
        db.optionalPosts.attach(post);

        user.optionalPosts.splice(0, 1);
        db.changeTracker.detectChanges();

        expect(post.authorId).toBeNull();
        expect(post.author).toBeNull();
        expect(db.entry(post)?.state).toBe('Modified');
    });

    it('rejects severing a required non-cascading relationship', () => {
        const db = createDb();
        const user = new User({ id: 'usr_1', restrictedPosts: [] });
        const post = new RestrictPost();
        post.id = 'post_1';
        post.authorId = user.id;
        post.author = user;
        user.restrictedPosts.push(post);
        db.users.attach(user);
        db.set(RestrictPost).attach(post);

        user.restrictedPosts.splice(0, 1);

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow(
            'Required relationship \'RestrictPost.author\' was severed',
        );
    });

    it('nulls optional tracked dependents when a principal is deleted', () => {
        const db = createDb();
        const user = new User({ id: 'usr_1', optionalPosts: [] });
        const post = new OptionalPost();
        post.id = 'post_1';
        post.authorId = user.id;
        post.author = user;
        user.optionalPosts.push(post);
        db.users.attach(user);
        db.optionalPosts.attach(post);

        db.users.remove(user);
        db.changeTracker.detectChanges();

        expect(post.authorId).toBeNull();
        expect(post.author).toBeNull();
        expect(db.entry(post)?.state).toBe('Modified');
    });

    it('leaves tracked NoAction dependents for the database to enforce', () => {
        const db = createDb();
        const user = new User({ id: 'usr_1', noActionPosts: [] });
        const post = new NoActionPost();
        post.id = 'post_1';
        post.authorId = user.id;
        post.author = user;
        user.noActionPosts.push(post);
        db.users.attach(user);
        db.set(NoActionPost).attach(post);

        db.users.remove(user);
        db.changeTracker.detectChanges();

        expect(db.entry(post)?.state).toBe('Unchanged');
        expect(post.authorId).toBe(user.id);
    });

    it('renders deterministic delete behavior SQL for reference relationships', () => {
        const model = new ModelBuilderImplementation();
        configureRelationshipModel(model);
        const script = new SchemaSqlBuilder().build(model.build());

        expect(script).toContain('constraint "fk_required_posts_users_author_id" foreign key ("author_id") references "users" ("id") on delete cascade');
        expect(script).toContain('constraint "fk_restrict_posts_users_author_id" foreign key ("author_id") references "users" ("id") on delete restrict');
        expect(script).toContain('constraint "fk_optional_posts_users_author_id" foreign key ("author_id") references "users" ("id") on delete set null');
        expect(script).toContain('constraint "fk_no_action_posts_users_author_id" foreign key ("author_id") references "users" ("id") on delete no action');
    });
});
