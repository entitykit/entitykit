import { requireDefined } from '../require-defined';
import {
    Comment,
    Issue,
    Label,
    Member,
    Organization,
    Project,
} from '../model/entities';
import {
    ACME,
    type DogfoodEnvironment,
    openAs,
    RIVAL,
} from './scenario-environment';

/** Onboarding: two organizations, so tenant isolation is exercised throughout. */
export async function seed(environment: DogfoodEnvironment): Promise<void> {
    const db =  openAs(environment, ACME, 'mem_ada');
    db.organizations.add(new Organization({
        id: ACME,
        slug: 'acme',
        name: 'Acme',
    }));
    db.organizations.add(new Organization({
        id: RIVAL,
        slug: 'rival',
        name: 'Rival',
    }));
    await db.saveChanges();

    db.members.add(new Member({
        id: 'mem_ada',
        organizationId: ACME,
        email: 'ada@acme.test',
        displayName: 'Ada',
        lastSeenAt: new Date('2026-02-01T00:00:00Z'),
    }));
    db.members.add(new Member({
        id: 'mem_bo',
        organizationId: ACME,
        email: 'bo@acme.test',
        displayName: 'Bo',
        lastSeenAt: null,
    }));

    db.projects.add(new Project({
        id: 'prj_web',
        organizationId: ACME,
        key: 'WEB',
        name: 'Website',
        archivedAt: null,
    }));
    db.projects.add(new Project({
        id: 'prj_api',
        organizationId: ACME,
        key: 'API',
        name: 'API',
        archivedAt: null,
    }));

    db.labels.add(new Label({
        id: 'lbl_bug',
        organizationId: ACME,
        name: 'bug',
    }));
    db.labels.add(new Label({
        id: 'lbl_urgent',
        organizationId: ACME,
        name: 'Urgent',
    }));
    await db.saveChanges();
    await db.dispose();

    // A tenant-scoped context refuses to write another tenant's rows, so the
    // second organization is seeded through its own context.
    const rival =  openAs(environment, RIVAL, 'mem_cy');
    rival.members.add(new Member({
        id: 'mem_cy',
        organizationId: RIVAL,
        email: 'cy@rival.test',
        displayName: 'Cy',
        lastSeenAt: null,
    }));
    rival.projects.add(new Project({
        id: 'prj_rival',
        organizationId: RIVAL,
        key: 'RIV',
        name: 'Rival',
        archivedAt: null,
    }));
    await rival.saveChanges();
    await rival.dispose();
}

/** File issues the way the product would, then assign and label them. */
export async function fileIssues(
    environment: DogfoodEnvironment,
): Promise<void> {
    const db =  openAs(environment, ACME, 'mem_ada');
    const now = new Date('2026-03-01T10:00:00Z');
    const rows: Array<[
        string,
        string,
        number,
        string,
        string,
    string | null,
    string | null,
    ]> = [
        ['iss_1', 'prj_web', 1, 'Login button misaligned', 'open', 'mem_ada', '1.5'],
        ['iss_2', 'prj_web', 2, 'Password reset email missing', 'in_progress', 'mem_bo', '3.25'],
        ['iss_3', 'prj_web', 3, 'Search returns nothing', 'open', null, null],
        ['iss_4', 'prj_api', 1, 'Rate limit too aggressive', 'closed', 'mem_ada', '8'],
        ['iss_5', 'prj_api', 2, 'Timeout on bulk export', 'open', null, '13.75'],
    ];
    for (const [id, projectId, number, title, status, assigneeId, estimate] of rows) {
        db.issues.add(new Issue({
            id,
            organizationId: ACME,
            projectId,
            number,
            title,
            status: status as Issue['status'],
            assigneeId,
            estimate,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1,
        }));
    }
    // A second tenant's issue, which must never appear in Acme's results.
    const rival =  openAs(environment, RIVAL, 'mem_cy');
    rival.issues.add(new Issue({
        id: 'iss_rival',
        organizationId: RIVAL,
        projectId: 'prj_rival',
        number: 1,
        title: 'Rival secret',
        status: 'open',
        assigneeId: null,
        estimate: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        version: 1,
    }));
    await db.saveChanges();
    await rival.saveChanges();

    const bug = await db.labels.find('lbl_bug');
    const urgent = await db.labels.find('lbl_urgent');
    const first = await db.issues.find('iss_1');
    const second = await db.issues.find('iss_2');
    db.link(requireDefined(first), issue => issue.labels, requireDefined(bug));
    db.link(requireDefined(second), issue => issue.labels, requireDefined(bug));
    db.link(requireDefined(second), issue => issue.labels, requireDefined(urgent));
    await db.saveChanges();

    db.comments.add(new Comment({
        id: 'cmt_1',
        organizationId: ACME,
        issueId: 'iss_1',
        authorId: 'mem_bo',
        body: 'Reproduced on Safari.',
        createdAt: now,
    }));
    db.comments.add(new Comment({
        id: 'cmt_2',
        organizationId: ACME,
        issueId: 'iss_1',
        authorId: 'mem_ada',
        body: 'Fix in review.',
        createdAt: now,
    }));
    await db.saveChanges();

    await db.dispose();
    await rival.dispose();
}
