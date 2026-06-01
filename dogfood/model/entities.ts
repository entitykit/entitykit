/**
 * Domain for the dogfood application: a small issue tracker, multi-tenant by
 * organization. The shape is chosen to exercise the features a real product
 * uses together — tenant scoping, soft delete, audit fields, optimistic
 * concurrency, all three relationship kinds — rather than each in isolation.
 */

export class Organization {
    public id!: string;
    public slug!: string;
    public name!: string;
    public projects?: Project[];

    constructor(data?: Partial<Organization>) {
        Object.assign(this, data);
    }
}

export class Member {
    public id!: string;
    public organizationId!: string;
    public email!: string;
    public displayName!: string;
    /** Nullable on purpose: exercises null ordering and optional-side joins. */
    public lastSeenAt!: Date | null;

    constructor(data?: Partial<Member>) {
        Object.assign(this, data);
    }
}

export class Project {
    public id!: string;
    public organizationId!: string;
    public key!: string;
    public name!: string;
    public archivedAt!: Date | null;
    public issues?: Issue[];

    constructor(data?: Partial<Project>) {
        Object.assign(this, data);
    }
}

export type IssueStatus = 'open' | 'in_progress' | 'closed';

export class Issue {
    public id!: string;
    public organizationId!: string;
    public projectId!: string;
    public number!: number;
    public title!: string;
    public status!: IssueStatus;
    /** Nullable foreign key: an unassigned issue has no member. */
    public assigneeId!: string | null;
    /** Exact money-like value; string to avoid float rounding. */
    public estimate!: string | null;
    public createdAt!: Date;
    public updatedAt!: Date;
    public deletedAt!: Date | null;
    public version!: number;

    public project?: Project;
    public assignee?: Member | null;
    public comments?: Comment[];
    public labels?: Label[];

    constructor(data?: Partial<Issue>) {
        Object.assign(this, data);
    }
}

export class Comment {
    public id!: string;
    public organizationId!: string;
    public issueId!: string;
    public authorId!: string;
    public body!: string;
    public createdAt!: Date;
    public issue?: Issue;

    constructor(data?: Partial<Comment>) {
        Object.assign(this, data);
    }
}

export class Label {
    public id!: string;
    public organizationId!: string;
    public name!: string;
    public issues?: Issue[];

    constructor(data?: Partial<Label>) {
        Object.assign(this, data);
    }
}
