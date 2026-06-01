export type MembershipRole = 'owner' | 'admin' | 'member';
export type SubscriptionPlan = 'free' | 'pro' | 'enterprise';
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void';

export class TrialWorkspace {
    public id!: string;
    public slug!: string;
    public name!: string;
    public createdAt!: Date;
    public users!: TrialUser[];
    public links!: TrialLink[];
    public tags!: TrialTag[];
}

export class TrialUser {
    public id!: string;
    public workspaceId!: string;
    public email!: string;
    public displayName!: string;
    public createdAt!: Date;
    public workspace!: TrialWorkspace | null;
    public memberships!: TrialMembership[];
}

export class TrialMembership {
    public id!: string;
    public workspaceId!: string;
    public userId!: string;
    public role!: MembershipRole;
    public createdAt!: Date;
    public workspace!: TrialWorkspace | null;
    public user!: TrialUser | null;
}

export class TrialLink {
    public id!: string;
    public workspaceId!: string;
    public creatorId!: string;
    public slug!: string;
    public url!: string;
    public title!: string;
    public archivedAt?: Date | null;
    public createdAt!: Date;
    public workspace!: TrialWorkspace | null;
    public creator!: TrialUser | null;
    public tags!: TrialTag[];
    public events!: TrialEvent[];
}

export class TrialTag {
    public id!: string;
    public workspaceId!: string;
    public slug!: string;
    public name!: string;
    public links!: TrialLink[];
}

export class TrialEvent {
    public id!: string;
    public workspaceId!: string;
    public linkId!: string;
    public eventType!: string;
    public country?: string | null;
    public occurredAt!: Date;
    public link!: TrialLink | null;
}

export class TrialSubscription {
    public id!: string;
    public workspaceId!: string;
    public plan!: SubscriptionPlan;
    public monthlyCents!: number;
    public activeAt!: Date;
    public canceledAt?: Date | null;
    public workspace!: TrialWorkspace | null;
}

export class TrialInvoice {
    public id!: string;
    public workspaceId!: string;
    public subscriptionId!: string;
    public status!: InvoiceStatus;
    public totalCents!: number;
    public dueAt!: Date;
    public paidAt?: Date | null;
    public workspace!: TrialWorkspace | null;
    public subscription!: TrialSubscription | null;
}
