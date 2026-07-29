import { RecordingDatabaseConnection } from './support/recording-database-connection';
import { TrialDbContext } from './support/production-query-trial-context';

describe('production-shaped query trial includes', () => {
    it('loads a detail graph shape through explicit relationship loading', async () => {
        const connection = new RecordingDatabaseConnection();
        TrialDbContext.connection = connection;
        const db =  TrialDbContext.create();
        const now = new Date('2026-06-01T00:00:00.000Z');

        connection.queueResult({
            rows: [{
                id: 'lnk_1',
                workspace_id: 'wrk_1',
                creator_id: 'usr_1',
                slug: 'launch',
                url: 'https://example.com',
                title: 'Launch',
                archived_at: null,
                created_at: now,
            }],
            rowCount: 1,
        });
        connection.queueResult({
            rows: [{
                id: 'usr_1',
                workspace_id: 'wrk_1',
                email: 'owner@example.com',
                display_name: 'Owner',
                created_at: now,
            }],
            rowCount: 1,
        });
        connection.queueResult({
            rows: [{
                __entitykit_parent_key: 'lnk_1',
                id: 'tag_1',
                workspace_id: 'wrk_1',
                slug: 'release',
                name: 'Release',
            }],
            rowCount: 1,
        });

        try {
            const link = await db.links
                .include(item => item.creator)
                .include(item => item.tags)
                .single();

            expect(link.creator?.email).toBe('owner@example.com');
            expect(link.tags.map(tag => tag.slug)).toEqual(['release']);
            expect(connection.statements.map(statement => statement.text)).toEqual([
                'select "id", "workspace_id", "archived_at", "creator_id", "slug", "url", "title", "created_at" from "trial_links" where ("archived_at" is null and "workspace_id" = $1) limit $2',
                'select "id", "workspace_id", "email", "display_name", "created_at" from "trial_users" where ("id" in ($1) and "workspace_id" = $2)',
                'select "j"."link_id" as "__entitykit_parent_key", "t"."id" as "id", "t"."workspace_id" as "workspace_id", "t"."slug" as "slug", "t"."name" as "name" from "trial_link_tags" "j" join "trial_tags" "t" on "j"."tag_id" = "t"."id" where "j"."link_id" in ($1) and "t"."workspace_id" = $2',
            ]);
        } finally {
            await db.dispose();
        }
    });
});
