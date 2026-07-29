import { requireDefined } from '../support/require-defined';
import { join } from 'node:path';
import { postgresProviderServices } from '../../src/providers/postgres';
import { sqliteProviderServices } from '../../src/providers/sqlite';
import * as app from '../../dogfood/scenarios';
import { createManagedSuiteTempDirectory } from '../support/managed-temp-directory';

/**
 * The dogfood application, run end to end against every shipped provider.
 *
 * Unlike the example apps — which run against a recording fake and therefore
 * only prove that SQL is emitted — this exercises a real database and asserts
 * real outcomes. Running the identical application on both providers also makes
 * it the broadest parity test there is.
 */
const shouldRunPostgres = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);

const environments: Array<{ name: string; make: () => app.DogfoodEnvironment }> = [];

environments.push({
    name: 'sqlite',
    make: () => {
        const sqliteDir = createManagedSuiteTempDirectory('ek-dogfood-');
        return {
            provider: sqliteProviderServices,
            connection: join(sqliteDir, 'tracker.db'),
            parameter: () => '?',
        };
    },
});

if (shouldRunPostgres) {
    environments.push({
        name: 'postgres',
        make: () => ({
            provider: postgresProviderServices,
            connection: requireDefined(process.env.DATABASE_URL),
            parameter: index => `$${String(index)}`,
        }),
    });
}

describe.each(environments)('issue tracker dogfood on $name', ({ make }) => {
    let environment: app.DogfoodEnvironment;

    beforeAll(async () => {
        environment = make();
        await app.createSchema(environment);
        await app.seed(environment);
        await app.fileIssues(environment);
    }, 60000);

    it('reports a dashboard grouped by status', async () => {
        expect(await app.dashboard(environment)).toEqual([
            { status: 'closed', issues: 1, estimate: '8' },
            { status: 'in_progress', issues: 1, estimate: '3.25' },
            { status: 'open', issues: 3, estimate: '15.25' },
        ]);
    });

    it('searches issue titles case-sensitively', async () => {
        expect(await app.search(environment, 'email')).toEqual(['iss_2']);
        // Case-sensitive on both providers, so a search box behaves the same way.
        expect(await app.search(environment, 'Email')).toEqual([]);
    });

    it('pages a backlog ordered by a nullable column', async () => {
    // Estimates ascending with the null last, so the unestimated issue is the
    // final row rather than the first.
        expect(await app.backlogPage(environment, 0, 2)).toEqual(['iss_1', 'iss_2']);
        expect(await app.backlogPage(environment, 2, 2)).toEqual(['iss_4', 'iss_5']);
        expect(await app.backlogPage(environment, 4, 2)).toEqual(['iss_3']);
    });

    it('loads an issue detail graph', async () => {
        expect(await app.issueDetail(environment, 'iss_2')).toEqual({
            title: 'Password reset email missing',
            project: 'WEB',
            assignee: 'Bo',
            comments: 0,
            labels: ['Urgent', 'bug'],
        });
    });

    it('loads an issue with comments and no assignee', async () => {
        expect(await app.issueDetail(environment, 'iss_3')).toEqual({
            title: 'Search returns nothing',
            project: 'WEB',
            assignee: null,
            comments: 0,
            labels: [],
        });
    });

    it('finds open issues that carry no labels', async () => {
        expect(await app.unlabelledOpenIssues(environment)).toEqual(['iss_3', 'iss_5']);
    });

    it('reports per-member workload including members with none', async () => {
        expect(await app.workload(environment)).toEqual([
            { member: 'Ada', issues: 2 },
            { member: 'Bo', issues: 1 },
        ]);
    });

    it('reports through the raw SQL escape hatch', async () => {
        expect(await app.rawReport(environment)).toEqual([
            { project: 'API', open: 1 },
            { project: 'WEB', open: 2 },
        ]);
    });

    it('keeps tenants isolated', async () => {
        expect(await app.rivalView(environment)).toEqual({
            issues: ['iss_rival'],
            members: ['mem_cy'],
        });
    });

    it('detects a concurrent edit', async () => {
        expect(await app.concurrentEdit(environment, 'iss_5')).toBe('DbUpdateConcurrencyError');
    });

    it('stamps audit fields on update', async () => {
        const { before, after } = await app.auditedUpdate(environment, 'iss_3');
        expect(after).toBeGreaterThan(before);
    });

    it('saves a project and its issues in one unit of work', async () => {
    // Four rows: the parent must be inserted before the children that
    // reference it, which is the save plan's dependency ordering.
        expect(await app.createProjectWithIssues(environment)).toBe(4);
    });

    it('pages an activity feed by cursor', async () => {
        const first = await app.activityFeed(environment, null, 1);
        expect(first).toEqual(['cmt_2']);

        // Same timestamp for both comments, so the id tiebreaker decides — which
        // needs comparison operators on a string column.
        const next = await app.activityFeed(
            environment,
            { createdAt: new Date('2026-03-01T10:00:00Z'), id: 'cmt_2' },
            5,
        );
        expect(next).toEqual(['cmt_1']);
    });

    it('assembles a filter from whatever the caller supplied', async () => {
        expect(await app.filterIssues(environment, {})).toEqual(
            ['iss_1', 'iss_2', 'iss_3', 'iss_4', 'iss_5', 'iss_mob_1', 'iss_mob_2', 'iss_mob_3'],
        );
        expect(await app.filterIssues(environment, { status: 'open', assigneeId: 'mem_ada' })).toEqual(['iss_1']);
        expect(await app.filterIssues(environment, { titleContains: 'Mobile' }))
            .toEqual(['iss_mob_1', 'iss_mob_2', 'iss_mob_3']);
    });

    it('summarizes activity over a nullable timestamp', async () => {
    // Only Ada has ever signed in; Bo and the bulk-imported members have not.
        const summary = await app.activitySummary(environment);
        expect(summary.members).toBe(2);
        expect(summary.seen).toBe(1);
        expect(summary.earliest).toBe('2026-02-01T00:00:00.000Z');
        expect(summary.latest).toBe('2026-02-01T00:00:00.000Z');
    });

    it('imports a batch of members in one save', async () => {
        const { saved, total } = await app.bulkImportMembers(environment, 50);
        expect(saved).toBe(50);
        expect(total).toBe(52);
    });

    it('stays usable after a rejected save', async () => {
        const { rejected, before, after, timestampMoved } = await app.rejectedSaveIsRecoverable(environment);

        // Classified identically on every provider, so an application can branch
        // on it rather than parsing a message.
        expect(rejected).toBe('UniqueConstraintError');
        // The whole unit of work rolled back, including the row that would have
        // succeeded on its own.
        expect(after).toBe(before);
        // And no audit timestamp was left behind from the attempt.
        expect(timestampMoved).toBe(false);
    });

    // Ordered last: these mutate the seeded data the reads above depend on.
    it('archives closed issues in one statement', async () => {
        expect(await app.archiveClosed(environment)).toBe(1);
    });

    it('loads relations lazily from an entity alone', async () => {
        const result = await app.issueDetailLazily(environment, 'iss_1');

        expect(result.project).toBe('Website');
        expect(result.comments).toBeGreaterThan(0);
        expect(result.reloadedWithoutQuerying).toBe(true);
        // A lazily loaded relation goes through the same filters as any read.
        expect(result.tenantRespected).toBe(true);
    });

    it('stops an N+1 written as a lazy load in a loop', async () => {
        const result = await app.lazyLoadBudgetStopsAnNPlusOne(environment);

        expect(result.loaded).toBe(2);
        expect(result.stoppedAfter).toBeGreaterThan(2);
        expect(result.error).toMatch(/lazy loads, which is its configured maximum/);
    });

    it('hides a soft-deleted issue but keeps the row', async () => {
        const { visible, withDeleted, everyTenant } = await app.softDeleteIssue(environment, 'iss_1');

        // Eight Acme issues by now (five seeded, three from the mobile project),
        // one of which has just been soft-deleted.
        expect(visible).toBe(7);

        // Asking for the deleted row back does not also hand over the other
        // organization's data — that takes ignoreTenantScope(), which the third
        // count uses to reach the rival's single issue.
        expect(withDeleted).toBe(8);
        expect(everyTenant).toBe(9);
    });

    it('re-runs an upstream sync without duplicating or failing', async () => {
        const feed = [
            { number: 1001, title: 'Imported one', status: 'open' as const },
            { number: 1002, title: 'Imported two', status: 'closed' as const },
        ];

        const result = await app.syncIssuesFromUpstream(environment, feed);

        expect(result.firstRun).toBe(2);
        expect(result.secondRun).toBe(2);
        // The second run updated in place rather than inserting again.
        expect(result.total).toBe(2);
        expect(result.titleAfterRerun).toBe('Imported one (corrected)');
    });

    it('refuses an upsert carrying another organization\'s row', async () => {
        const result = await app.upsertRefusesAnotherOrganization(environment);

        expect(result.error).toMatch(/tenant key 'organizationId' must match the current tenant scope/);
        expect(result.leaked).toBe(0);
    });

});
