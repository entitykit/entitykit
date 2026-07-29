import { EntityState } from '../src';
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
});
