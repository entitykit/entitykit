import { createTrialDb } from './support/production-query-trial-context';

describe('production-shaped query trial schema', () => {
    it('models the production-shaped trial schema with current EntityKit primitives', async () => {
        const db =  createTrialDb();

        try {
            expect(contextModel(db).entities.map(entity => entity.entityName)).toEqual([
                'TrialWorkspace',
                'TrialUser',
                'TrialMembership',
                'TrialLink',
                'TrialTag',
                'TrialEvent',
                'TrialSubscription',
                'TrialInvoice',
            ]);

            const schema = db.database.createScript();
            expect(schema).toContain('create table if not exists "trial_links"');
            expect(schema).toContain('create table if not exists "trial_events"');
            expect(schema).toContain('create table if not exists "trial_subscriptions"');
            expect(schema).toContain('create table if not exists "trial_invoices"');
            expect(schema).toContain('create table if not exists "trial_link_tags"');
            expect(schema).toContain('create unique index if not exists "ux_trial_links_workspace_slug"');
        } finally {
            await db.dispose();
        }
    });
});
import { contextModel } from './support/public-api-internals';
