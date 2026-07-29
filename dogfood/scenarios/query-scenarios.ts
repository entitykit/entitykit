import { requireDefined } from '../require-defined';
import {
    ACME,
    type DogfoodEnvironment,
    openAs,
} from './scenario-environment';

export interface DashboardRow {
    status: string;
    issues: number;
    estimate: string | null;
}

/** The screen every tracker has: counts and totals grouped by status. */
export async function dashboard(
    environment: DogfoodEnvironment,
): Promise<DashboardRow[]> {
    const db =  openAs(environment, ACME);
    try {
        const counts = await db.issues
            .groupBy(issue => ({ status: issue.status }))
            .orderBy(group => group.key.status)
            .select(group => ({ status: group.key.status, issues: group.count() }))
            .toArray();

        // `estimate` is mapped to string for exactness, and `sum(...)` returns a
        // JavaScript number — which would round it. Exact totals go through raw
        // SQL, which keeps the provider's exact representation.
        const totals = await db.database.connection.query<{
            status: string;
            total: string | number | null;
        }>({
            text: `select "status", sum("estimate") as "total"
             from "issues"
             where "organization_id" = ${environment.parameter(1)} and "deleted_at" is null
             group by "status"`,
            values: [ACME],
        });
        const totalByStatus = new Map(
            totals.rows.map(row => [row.status, row.total]),
        );

        return counts.map(row => {
            const total = totalByStatus.get(row.status);
            return {
                status: row.status,
                issues: row.issues,
                estimate: total === null || total === undefined ? null : String(total),
            };
        });
    } finally {
        await db.dispose();
    }
}

/** Free-text search, as a search box would issue it. */
export async function search(
    environment: DogfoodEnvironment,
    term: string,
): Promise<string[]> {
    const db =  openAs(environment, ACME);
    try {
        const found = await db.issues
            .where(issue => issue.title.contains(term))
            .orderBy(issue => issue.number)
            .toArray();
        return found.map(issue => issue.id);
    } finally {
        await db.dispose();
    }
}

/** A paged backlog ordered by a nullable column — the classic pagination shape. */
export async function backlogPage(
    environment: DogfoodEnvironment,
    skip: number,
    take: number,
): Promise<string[]> {
    const db =  openAs(environment, ACME);
    try {
        const page = await db.issues
            .orderBy(issue => issue.estimate)
            .orderBy(issue => issue.id)
            .skip(skip)
            .take(take)
            .toArray();
        return page.map(issue => issue.id);
    } finally {
        await db.dispose();
    }
}

/** The issue detail view: one issue with its whole graph loaded. */
export async function issueDetail(
    environment: DogfoodEnvironment,
    issueId: string,
): Promise<{
    title: string;
    project: string;
    assignee: string | null;
    comments: number;
    labels: string[];
}> {
    const db =  openAs(environment, ACME);
    try {
        const issue = await db.issues
            .where(candidate => candidate.id.eq(issueId))
            .include(candidate => candidate.project)
            .include(candidate => candidate.assignee)
            .include(candidate => candidate.comments)
            .include(candidate => candidate.labels)
            .single();
        return {
            title: issue.title,
            project: requireDefined(issue.project).key,
            assignee: issue.assignee ? issue.assignee.displayName : null,
            comments: requireDefined(issue.comments).length,
            labels: requireDefined(issue.labels).map(label => label.name).sort(),
        };
    } finally {
        await db.dispose();
    }
}

/** Unassigned open work, found through a relation filter rather than a join. */
export async function unlabelledOpenIssues(
    environment: DogfoodEnvironment,
): Promise<string[]> {
    const db =  openAs(environment, ACME);
    try {
        const rows = await db.issues
            .where(issue => issue.status.eq('open'))
            .whereDoesNotHave(issue => issue.labels)
            .orderBy(issue => issue.id)
            .toArray();
        return rows.map(issue => issue.id);
    } finally {
        await db.dispose();
    }
}

/** Members with the issues assigned to them, including those with none. */
export async function workload(
    environment: DogfoodEnvironment,
): Promise<Array<{ member: string; issues: number }>> {
    const db =  openAs(environment, ACME);
    try {
        const members = await db.members
            .orderBy(member => member.displayName)
            .toArray();
        const results: Array<{ member: string; issues: number }> = [];
        for (const member of members) {
            const count = await db.issues
                .where(issue => issue.assigneeId.eq(member.id))
                .count();
            results.push({ member: member.displayName, issues: count });
        }
        return results;
    } finally {
        await db.dispose();
    }
}
