import { requireDefined } from '../require-defined';
import { Issue, Member, Project } from '../model/entities';
import {
    ACME,
    type DogfoodEnvironment,
    openAs,
} from './scenario-environment';

/**
 * Create a project and its issues in one unit of work.
 *
 * Applications do this constantly, and it depends on the save plan ordering
 * inserts so the parent exists before its children reference it.
 */
export async function createProjectWithIssues(
    environment: DogfoodEnvironment,
): Promise<number> {
    const db =  openAs(environment, ACME, 'mem_ada');
    try {
        const now = new Date('2026-04-01T09:00:00Z');
        const project = new Project({
            id: 'prj_mobile',
            organizationId: ACME,
            key: 'MOB',
            name: 'Mobile',
            archivedAt: null,
        });
        db.projects.add(project);
        for (let index = 1; index <= 3; index++) {
            db.issues.add(new Issue({
                id: `iss_mob_${String(index)}`,
                organizationId: ACME,
                projectId: project.id,
                number: index,
                title: `Mobile issue ${String(index)}`,
                status: 'open',
                assigneeId: null,
                estimate: null,
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
                version: 1,
            }));
        }
        // One call: the project and the issues that point at it.
        return await db.saveChanges();
    } finally {
        await db.dispose();
    }
}

/**
 * Keyset pagination over an activity feed: newer first, ties broken by id.
 *
 * Offset paging drifts when rows are inserted mid-scroll, so feeds page by
 * cursor instead.
 */
export async function activityFeed(
    environment: DogfoodEnvironment,
    cursor: { createdAt: Date; id: string } | null,
    take: number,
): Promise<string[]> {
    const db =  openAs(environment, ACME);
    try {
        const page = await db.comments
            .whereIf(
                cursor !== null,
                comment => comment.createdAt.lt(requireDefined(cursor).createdAt)
                    .or(
                        comment.createdAt.eq(requireDefined(cursor).createdAt)
                            .and(comment.id.lt(requireDefined(cursor).id)),
                    ),
            )
            .orderByDescending(comment => comment.createdAt)
            .orderByDescending(comment => comment.id)
            .take(take)
            .toArray();
        return page.map(comment => comment.id);
    } finally {
        await db.dispose();
    }
}

/** A filter assembled from whatever the caller supplied, as a filter bar does. */
export async function filterIssues(
    environment: DogfoodEnvironment,
    filters: {
        status?: string;
        assigneeId?: string;
        titleContains?: string;
    },
): Promise<string[]> {
    const db =  openAs(environment, ACME);
    try {
        const found = await db.issues
            .whereIf(
                filters.status !== undefined,
                issue => issue.status.eq(filters.status as never),
            )
            .whereIf(
                filters.assigneeId !== undefined,
                issue => issue.assigneeId.eq(requireDefined(filters.assigneeId)),
            )
            .whereIf(
                filters.titleContains !== undefined,
                issue => issue.title.contains(requireDefined(filters.titleContains)),
            )
            .orderBy(issue => issue.id)
            .toArray();
        return found.map(issue => issue.id);
    } finally {
        await db.dispose();
    }
}

/** Import a batch of members, as a CSV upload would. */
export async function bulkImportMembers(
    environment: DogfoodEnvironment,
    count: number,
): Promise<{ saved: number; total: number }> {
    const db =  openAs(environment, ACME, 'mem_ada');
    try {
        for (let index = 0; index < count; index++) {
            db.members.add(new Member({
                id: `mem_bulk_${String(index)}`,
                organizationId: ACME,
                email: `bulk${String(index)}@acme.test`,
                displayName: `Bulk ${String(index)}`,
                lastSeenAt: null,
            }));
        }
        const saved = await db.saveChanges();
        db.changeTracker.clear();
        return { saved, total: await db.members.count() };
    } finally {
        await db.dispose();
    }
}

/**
 * Team activity summary.
 *
 * `lastSeenAt` is nullable — members who have never signed in — which is the
 * ordinary case for min/max in a real schema.
 */
export async function activitySummary(environment: DogfoodEnvironment): Promise<{
    members: number;
    seen: number;
    earliest: string | null;
    latest: string | null;
}> {
    const db =  openAs(environment, ACME);
    try {
        const summary = await db.members
            .aggregate(group => ({
                members: group.count(),
                seen: group.count(member => member.lastSeenAt),
                earliest: group.min(member => member.lastSeenAt),
                latest: group.max(member => member.lastSeenAt),
            }))
            .single();
        return {
            members: summary.members,
            seen: summary.seen,
            earliest: summary.earliest
                ? new Date(summary.earliest).toISOString()
                : null,
            latest: summary.latest
                ? new Date(summary.latest).toISOString()
                : null,
        };
    } finally {
        await db.dispose();
    }
}
