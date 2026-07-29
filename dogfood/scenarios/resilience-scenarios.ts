import { requireDefined } from '../require-defined';
import { lazy } from '../../src';
import { Issue } from '../model/entities';
import {
    ACME,
    type DogfoodEnvironment,
    openAs,
} from './scenario-environment';

/**
 * A save that violates a constraint, as a duplicate submission would.
 *
 * What matters afterwards is that the context is still usable: the entity is
 * still pending, nothing partial was written, and correcting the input and
 * saving again works.
 */
export async function rejectedSaveIsRecoverable(
    environment: DogfoodEnvironment,
): Promise<{
    rejected: string;
    before: number;
    after: number;
    timestampMoved: boolean;
}> {
    const db =  openAs(environment, ACME, 'mem_ada');
    try {
        const before = await db.issues.count();
        const existing = await db.issues.find('iss_2');
        const stamped = requireDefined(existing).updatedAt.getTime();

        // Two issues, the second reusing the first's primary key.
        const now = new Date('2026-05-01T00:00:00Z');
        db.issues.add(new Issue({
            id: 'iss_new',
            organizationId: ACME,
            projectId: 'prj_web',
            number: 90,
            title: 'Fresh',
            status: 'open',
            assigneeId: null,
            estimate: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1,
        }));
        db.issues.add(new Issue({
            id: 'iss_1',
            organizationId: ACME,
            projectId: 'prj_web',
            number: 91,
            title: 'Duplicate',
            status: 'open',
            assigneeId: null,
            estimate: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1,
        }));

        let rejected = 'no error';
        try {
            await db.saveChanges();
        } catch (error) {
            rejected = (error as Error).constructor.name;
        }

        // Nothing partial, and an unrelated tracked entity is untouched.
        const after = await db.issues.count();
        const timestampMoved = requireDefined(existing).updatedAt.getTime() !== stamped;
        return { rejected, before, after, timestampMoved };
    } finally {
        await db.dispose();
    }
}

/**
 * An issue detail page: the caller has an issue and discovers it needs the
 * project and the comments, without having planned for them at query time.
 *
 * The point of lazy loading is that this reads as ordinary domain code and does
 * not need the context in scope to do it.
 */
export async function issueDetailLazily(
    environment: DogfoodEnvironment,
    issueId: string,
): Promise<{
    project: string;
    comments: number;
    reloadedWithoutQuerying: boolean;
    tenantRespected: boolean;
}> {
    const db =  openAs(environment, ACME, 'mem_ada', {});
    try {
        const issue = await db.issues.find(issueId);

        const project = await lazy(requireDefined(issue)).project;
        const comments = await lazy(requireDefined(issue)).comments;

        // A second await resolves from memory, and the value is on the entity now.
        const before = db.database;
        const again = await lazy(requireDefined(issue)).project;

        return {
            project: project.name,
            comments: comments.length,
            reloadedWithoutQuerying: again === project && requireDefined(issue).project === project,
            // Lazily loaded relations go through the same query filters as any other
            // read, so they cannot reach another organization's rows.
            tenantRespected: Boolean(before) && project.organizationId === ACME,
        };
    } finally {
        await db.dispose();
    }
}

/** A lazy load inside a loop is an N+1; a budget turns it into a failure. */
export async function lazyLoadBudgetStopsAnNPlusOne(
    environment: DogfoodEnvironment,
): Promise<{ loaded: number; stoppedAfter: number; error: string }> {
    const db =  openAs(environment, ACME, 'mem_ada', { maxPerContext: 2 });
    try {
        const issues = await db.issues
            .orderBy(issue => issue.id)
            .take(5)
            .toArray();
        let loaded = 0;
        let error = 'no error';
        for (const issue of issues) {
            try {
                await lazy(issue).project;
                loaded += 1;
            } catch (caught) {
                error = (caught as Error).message;
                break;
            }
        }
        return { loaded, stoppedAfter: issues.length, error };
    } finally {
        await db.dispose();
    }
}
