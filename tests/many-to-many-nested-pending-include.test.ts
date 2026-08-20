import type {
    IncludeLoaderContext,
    IncludeLoadRoot,
    ManyToManyRelationshipInfo,
} from '../packages/core/src/query/include-loader-context';
import {
    assignManyToManyRelated,
} from '../packages/core/src/query/include-many-to-many-stitch';
import { directNavigationWriter } from '../packages/core/src/tracking/navigation-writer';
import {
    IncludeManyToManyContext,
    Post,
    Tag,
} from './support/many-to-many-include-context';
import { setMetadata } from './support/public-api-internals';
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

    it('recurses into the related roots the stitch actually applied', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = IncludeManyToManyContext.createWith(connection);
        connection.queueResult({
            rows: [{ id: 'post_1', title: 'Hello' }], rowCount: 1,
        });
        connection.queueResult({
            rows: [{
                __entitykit_parent_key: 'post_1', id: 'tag_1',
                workspace_id: 'wrk_1', name: 'TypeScript', deleted_at: null,
            }],
            rowCount: 1,
        });
        connection.queueResult({
            rows: [{
                __entitykit_parent_key: 'tag_1', id: 'post_2', title: 'Second',
            }],
            rowCount: 1,
        });

        const posts = await db.posts.include(item => item.tags)
            .thenInclude(item => item.posts).toArray();

        expect(posts[0]?.tags.map(item => item.id)).toEqual(['tag_1']);
        expect(connection.statements).toHaveLength(3);
        expect(connection.statements[2]?.values).toEqual(['tag_1']);
    });

    it('keeps a pending inverse edit out of the stitched merge', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = IncludeManyToManyContext.createWith(connection);
        const tag = new Tag({
            id: 'tag_1', workspaceId: 'wrk_1', name: 'TypeScript',
        });
        const local = new Post({ id: 'post_9', title: 'Local' });
        db.tags.attach(tag);
        db.posts.attach(local);
        tag.posts = [local];
        connection.queueResult({
            rows: [{ id: 'post_1', title: 'Hello' }], rowCount: 1,
        });
        connection.queueResult({
            rows: [{
                __entitykit_parent_key: 'post_1', id: 'tag_1',
                workspace_id: 'wrk_1', name: 'TypeScript', deleted_at: null,
            }],
            rowCount: 1,
        });

        const posts = await db.posts.include(item => item.tags).toArray();

        expect(posts[0]?.tags[0]).toBe(tag);
        expect(tag.posts.map(item => item.id)).toEqual(['post_9']);
    });
});

/** The stitcher's own guardrails, reached below the include strategies. */
describe('many-to-many stitch guardrails', () => {
    const context = IncludeManyToManyContext.createWith(
        new RecordingDatabaseConnection(),
    );
    const ctx = {
        changeTracker: { entry: (): undefined => undefined },
        journal: directNavigationWriter,
        preservePendingRelationships: false,
    } as unknown as IncludeLoaderContext;

    function stitchInfo(inverse?: string): ManyToManyRelationshipInfo {
        return {
            currentMetadata: setMetadata(context.posts),
            relatedMetadata: setMetadata(context.tags),
            navigationProperty: 'tags',
            relatedInverseNavigationProperty: inverse,
        } as unknown as ManyToManyRelationshipInfo;
    }

    function root(entity: Post | Tag, id: string): IncludeLoadRoot {
        return { entity, values: { id }, boundValues: { id } };
    }

    it('skips a row whose related root never materialized', () => {
        const post = new Post({ id: 'post_1', title: 'Hello' });
        const tag = new Tag({
            id: 'tag_1', workspaceId: 'wrk_1', name: 'Alpha',
        });

        const applied = assignManyToManyRelated(
            ctx,
            [
                { __entitykit_parent_key: 'post_1' },
                { __entitykit_parent_key: 'post_1' },
            ],
            [root(tag, 'tag_1')],
            [root(post, 'post_1')],
            stitchInfo('posts'),
        );

        expect(post.tags).toEqual([tag]);
        expect(tag.posts).toEqual([post]);
        expect(applied.map(item => item.entity)).toEqual([tag]);
    });

    it('stitches a relationship that configures no inverse navigation', () => {
        const post = new Post({ id: 'post_1', title: 'Hello' });
        const tag = new Tag({
            id: 'tag_1', workspaceId: 'wrk_1', name: 'Alpha',
        });

        assignManyToManyRelated(
            ctx,
            [{ __entitykit_parent_key: 'post_1' }],
            [root(tag, 'tag_1')],
            [root(post, 'post_1')],
            stitchInfo(),
        );

        expect(post.tags).toEqual([tag]);
        expect(tag.posts).toEqual([]);
    });
});
