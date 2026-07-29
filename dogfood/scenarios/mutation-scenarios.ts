import { requireDefined } from '../require-defined';
import {
    ACME,
    type DogfoodEnvironment,
    openAs,
    RIVAL,
} from './scenario-environment';

/** Housekeeping: archive every closed issue without loading any of them. */
export async function archiveClosed(
    environment: DogfoodEnvironment,
): Promise<number> {
    const db =  openAs(environment, ACME);
    try {
        return await db.issues
            .where(issue => issue.status.eq('closed'))
            .executeUpdate({ title: '[archived]' });
    } finally {
        await db.dispose();
    }
}

/**
 * Soft delete, then confirm the row is hidden from ordinary queries and how an
 * administrative view asks for it back.
 */
export async function softDeleteIssue(
    environment: DogfoodEnvironment,
    issueId: string,
): Promise<{ visible: number; withDeleted: number; everyTenant: number }> {
    const db =  openAs(environment, ACME, 'mem_ada');
    try {
        const issue = await db.issues.find(issueId);
        db.issues.remove(requireDefined(issue));
        await db.saveChanges();
        db.changeTracker.clear();

        const visible = await db.issues.count();
        // The natural way to ask for the deleted rows back. It stays inside this
        // organization: tenant scope is not something a soft-delete opt-out drops.
        const withDeleted = await db.issues.ignoreQueryFilters().count();
        // Leaving the organization is a separate, deliberate act.
        const everyTenant = await db.issues
            .ignoreQueryFilters()
            .ignoreTenantScope()
            .count();
        return { visible, withDeleted, everyTenant };
    } finally {
        await db.dispose();
    }
}

/** Everything the other tenant can see. Should never include Acme's data. */
export async function rivalView(
    environment: DogfoodEnvironment,
): Promise<{ issues: string[]; members: string[] }> {
    const db =  openAs(environment, RIVAL, 'mem_cy');
    try {
        return {
            issues: (await db.issues.orderBy(issue => issue.id).toArray())
                .map(issue => issue.id),
            members: (await db.members.orderBy(member => member.id).toArray())
                .map(member => member.id),
        };
    } finally {
        await db.dispose();
    }
}

/** Two people editing the same issue: the second save must be rejected. */
export async function concurrentEdit(
    environment: DogfoodEnvironment,
    issueId: string,
): Promise<string> {
    const first =  openAs(environment, ACME, 'mem_ada');
    const second =  openAs(environment, ACME, 'mem_bo');
    try {
        const a = await first.issues.find(issueId);
        const b = await second.issues.find(issueId);
        requireDefined(a).title = 'Edited by Ada';
        await first.saveChanges();

        requireDefined(b).title = 'Edited by Bo';
        try {
            await second.saveChanges();
            return 'no conflict detected';
        } catch (error) {
            return (error as Error).constructor.name;
        }
    } finally {
        await first.dispose();
        await second.dispose();
    }
}

/** A report the query DSL does not cover, through the raw SQL escape hatch. */
export async function rawReport(
    environment: DogfoodEnvironment,
): Promise<Array<{ project: string; open: number }>> {
    const db =  openAs(environment, ACME);
    try {
        const rows = await db.database.connection.query<{
            key: string;
            open: number | string;
        }>({
            text: `select p."key" as "key", count(i."id") as "open"
             from "projects" p
             left join "issues" i
               on i."project_id" = p."id"
              and i."status" = ${environment.parameter(1)}
              and i."deleted_at" is null
             where p."organization_id" = ${environment.parameter(2)}
             group by p."key"
             order by p."key"`,
            values: ['open', ACME],
        });
        return rows.rows.map(row => ({
            project: row.key,
            open: Number(row.open),
        }));
    } finally {
        await db.dispose();
    }
}

/** An audit field the context populates rather than the caller. */
export async function auditedUpdate(
    environment: DogfoodEnvironment,
    issueId: string,
): Promise<{ before: number; after: number }> {
    const db =  openAs(environment, ACME, 'mem_ada');
    try {
        const issue = await db.issues.find(issueId);
        const before = requireDefined(issue).updatedAt.getTime();
        await new Promise(resolve => setTimeout(resolve, 5));
        requireDefined(issue).title = `${requireDefined(issue).title} (touched)`;
        await db.saveChanges();
        return { before, after: requireDefined(issue).updatedAt.getTime() };
    } finally {
        await db.dispose();
    }
}
