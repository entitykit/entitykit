import { ContextStateRestorationError, EntityState } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import {
    createRelationshipDb,
    RequiredPost,
    User,
} from './support/relationship-model';
import { internalEntityEntry } from './support/public-api-internals';

describe('concurrency reload relationship fixup', () => {
    it('moves a reference when database-wins changes its foreign key', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createRelationshipDb(connection);
        const original = new User({
            id: 'usr_1',
            cascadePosts: [],
        });
        const replacement = new User({
            id: 'usr_2',
            cascadePosts: [],
        });
        const post = new RequiredPost({
            id: 'post_1',
            title: 'Moved elsewhere',
            authorId: original.id,
            author: original,
        });
        original.cascadePosts.push(post);
        db.users.attach(original);
        db.users.attach(replacement);
        const entry = db.requiredPosts.attach(post);
        internalEntityEntry(entry).markNavigationLoaded('author');
        connection.queueResult({
            rows: [{
                id: 'post_1',
                title: 'Moved in the database',
                author_id: 'usr_2',
            }],
            rowCount: 1,
        });

        await expect(entry.reload()).resolves.toBe(true);

        expect(post).toMatchObject({
            title: 'Moved in the database',
            authorId: 'usr_2',
            author: replacement,
        });
        expect(original.cascadePosts).toEqual([]);
        expect(replacement.cascadePosts).toEqual([post]);
        expect(entry.isNavigationLoaded('author')).toBe(false);
        expect(entry.state).toBe(EntityState.Unchanged);

        post.author = original;
        db.changeTracker.detectChanges();
        expect(post.authorId).toBe('usr_1');
        expect(original.cascadePosts).toEqual([post]);
        expect(replacement.cascadePosts).toEqual([]);
        expect(entry.state).toBe(EntityState.Modified);
    });

    it('restores the full graph when a navigation setter mutates then throws', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createRelationshipDb(connection);
        const original = new User({ id: 'usr_1', cascadePosts: [] });
        const replacement = new User({ id: 'usr_2', cascadePosts: [] });
        const post = new RequiredPost({
            id: 'post_1', title: 'before', authorId: original.id,
            author: original,
        });
        original.cascadePosts.push(post);
        db.users.attach(original);
        db.users.attach(replacement);
        const entry = db.requiredPosts.attach(post);
        internalEntityEntry(entry).markNavigationLoaded('author');
        const primary = 'navigation fixup failed';
        let author: User | null = original;
        Object.defineProperty(post, 'author', {
            configurable: true,
            enumerable: true,
            get: () => author,
            set: (value: User | null) => {
                author = value;
                if (value === replacement) {
                    // Deliberately exercise an exact primitive fixup failure.
                    // eslint-disable-next-line @typescript-eslint/only-throw-error
                    throw primary;
                }
            },
        });
        connection.queueResult({
            rows: [{
                id: 'post_1', title: 'database', author_id: 'usr_2',
            }],
            rowCount: 1,
        });

        expect(await rejection(async () => entry.reload())).toBe(primary);
        expect(post).toMatchObject({
            title: 'before', authorId: 'usr_1', author: original,
        });
        expect(original.cascadePosts).toEqual([post]);
        expect(replacement.cascadePosts).toEqual([]);
        expect(entry.isNavigationLoaded('author')).toBe(true);
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(() => {
            db.changeTracker.detectChanges();
        }).not.toThrow();
    });

    it('poisons the context when navigation restoration is refused', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createRelationshipDb(connection);
        const original = new User({ id: 'usr_1', cascadePosts: [] });
        const replacement = new User({ id: 'usr_2', cascadePosts: [] });
        const post = new RequiredPost({
            id: 'post_1', title: 'before', authorId: original.id,
            author: original,
        });
        original.cascadePosts.push(post);
        db.users.attach(original);
        db.users.attach(replacement);
        const entry = db.requiredPosts.attach(post);
        let author: User | null = original;
        Object.defineProperty(post, 'author', {
            configurable: true,
            enumerable: true,
            get: () => author,
            set: (value: User | null) => {
                if (value === original && author !== original) return;
                author = value;
                if (value === replacement) throw new Error('fixup failed');
            },
        });
        connection.queueResult({
            rows: [{
                id: 'post_1', title: 'database', author_id: 'usr_2',
            }],
            rowCount: 1,
        });

        await expect(entry.reload()).rejects.toThrow('fixup failed');
        expect(() => {
            db.changeTracker.detectChanges();
        })
            .toThrow(ContextStateRestorationError);
    });
});

async function rejection(action: () => unknown): Promise<unknown> {
    try {
        await action();
    } catch (error) {
        return error;
    }
    throw new Error('Expected operation to reject.');
}
