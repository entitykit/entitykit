import {
    IncludeManyToManyContext,
    Post,
    Tag,
} from './support/many-to-many-include-context';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

describe('many-to-many nested includes with pending intent', () => {
    it('does not recurse through a stored link skipped by pending link intent', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = IncludeManyToManyContext.createWith(connection);
        const post = new Post({ id: 'post_1', title: 'Hello' });
        const local = new Tag({
            id: 'local', workspaceId: 'wrk_1', name: 'Local',
        });
        db.posts.attach(post);
        db.tags.attach(local);
        db.link(post, item => item.tags, local);
        connection.queueResult({
            rows: [{ id: 'post_1', title: 'Hello' }], rowCount: 1,
        });
        connection.queueResult({
            rows: [{
                __entitykit_parent_key: 'post_1', id: 'stored',
                workspace_id: 'wrk_1', name: 'Stored', deleted_at: null,
            }],
            rowCount: 1,
        });

        await db.posts.include(item => item.tags)
            .thenInclude(item => item.posts).single();

        expect(post.tags).toEqual([local]);
        expect(connection.statements).toHaveLength(2);
    });
});
