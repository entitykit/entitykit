import { requireDefined } from '../require-defined';
import { Issue, type IssueStatus } from '../model/entities';
import {
    ACME,
    type DogfoodEnvironment,
    openAs,
    RIVAL,
} from './scenario-environment';

/**
 * A nightly sync from an upstream system: rows arrive keyed by the upstream's
 * own identifier, some new, some already imported. Re-running it must be safe.
 */
export async function syncIssuesFromUpstream(
    environment: DogfoodEnvironment,
    incoming: ReadonlyArray<{
        readonly number: number;
        readonly title: string;
        readonly status: IssueStatus;
    }>,
): Promise<{
    firstRun: number;
    secondRun: number;
    total: number;
    titleAfterRerun: string;
}> {
    const db =  openAs(environment, ACME, 'mem_ada');
    try {
        const now = new Date('2026-07-01T00:00:00.000Z');
        const toEntity = (row: {
            number: number;
            title: string;
            status: IssueStatus;
        }): Issue => new Issue({
            id: `iss_up_${String(row.number)}`,
            organizationId: ACME,
            projectId: 'prj_web',
            number: row.number,
            title: row.title,
            status: row.status,
            assigneeId: null,
            estimate: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1,
        });

        const firstRun = await db.issues.upsert(incoming.map(toEntity));

        // The same feed again, with one title corrected upstream. Re-running must
        // update in place rather than fail on the primary key.
        const corrected = incoming.map((row, index) => index === 0
            ? { ...row, title: `${row.title} (corrected)` }
            : row);
        const secondRun = await db.issues.upsert(corrected.map(toEntity));

        const reloaded = await db.issues.find(`iss_up_${String(incoming[0].number)}`);
        return {
            firstRun,
            secondRun,
            total: await db.issues
                .where(issue => issue.number.gte(1000))
                .count(),
            titleAfterRerun: requireDefined(reloaded).title,
        };
    } finally {
        await db.dispose();
    }
}

/** An upsert must not be the way around tenant isolation. */
export async function upsertRefusesAnotherOrganization(
    environment: DogfoodEnvironment,
): Promise<{ error: string; leaked: number }> {
    const db =  openAs(environment, ACME, 'mem_ada');
    try {
        const now = new Date('2026-07-01T00:00:00.000Z');
        const foreign = new Issue({
            id: 'iss_foreign',
            organizationId: RIVAL,
            projectId: 'prj_web',
            number: 4242,
            title: 'Should never land',
            status: 'open',
            assigneeId: null,
            estimate: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1,
        });

        let error = 'no error';
        try {
            await db.issues.upsert([foreign]);
        } catch (caught) {
            error = (caught as Error).message;
        }

        const leaked = await db.issues
            .ignoreQueryFilters()
            .ignoreTenantScope()
            .where(issue => issue.id.eq('iss_foreign'))
            .count();
        return { error, leaked };
    } finally {
        await db.dispose();
    }
}
