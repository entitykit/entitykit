import type { DbContextOptionsBuilder, ModelBuilder } from '../../packages/core/src';
import { DbContext, enumString } from '../../packages/core/src';
import { RecordingDatabaseConnection } from './recording-database-connection';
import {
    type InvoiceStatus,
    type MembershipRole,
    type SubscriptionPlan,
    TrialEvent,
    TrialInvoice,
    TrialLink,
    TrialMembership,
    TrialSubscription,
    TrialTag,
    TrialUser,
    TrialWorkspace,
} from './production-query-trial-entities';

export class TrialDbContext extends DbContext {
    public static connection = new RecordingDatabaseConnection();

    public workspaces = this.set(TrialWorkspace);
    public users = this.set(TrialUser);
    public memberships = this.set(TrialMembership);
    public links = this.set(TrialLink);
    public tags = this.set(TrialTag);
    public events = this.set(TrialEvent);
    public subscriptions = this.set(TrialSubscription);
    public invoices = this.set(TrialInvoice);

    protected override configure(options: DbContextOptionsBuilder): void {
        options
            .useConnection(TrialDbContext.connection)
            .useTenantScope(() => 'wrk_1');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(TrialWorkspace, entity => {
            entity.toTable('trial_workspaces');
            entity.hasKey(workspace => workspace.id);
            entity.property(workspace => workspace.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(workspace => workspace.slug).hasColumnName('slug').hasColumnType('text').isRequired();
            entity.property(workspace => workspace.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(workspace => workspace.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.ignore(workspace => workspace.users);
            entity.ignore(workspace => workspace.links);
            entity.ignore(workspace => workspace.tags);
            entity.hasIndex(workspace => workspace.slug).isUnique().hasDatabaseName('ux_trial_workspaces_slug');
        });

        model.entity(TrialUser, entity => {
            entity.toTable('trial_users');
            entity.hasKey(user => user.id);
            entity.tenantKey(user => user.workspaceId);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(user => user.displayName).hasColumnName('display_name').hasColumnType('text').isRequired();
            entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.ignore(user => user.workspace);
            entity.ignore(user => user.memberships);
            entity.hasOne(TrialWorkspace, user => user.workspace)
                .withMany(workspace => workspace.users)
                .hasForeignKey(user => user.workspaceId);
            entity.hasIndex(user => [user.workspaceId, user.email]).isUnique().hasDatabaseName('ux_trial_users_workspace_email');
        });

        model.entity(TrialMembership, entity => {
            entity.toTable('trial_memberships');
            entity.hasKey(membership => membership.id);
            entity.tenantKey(membership => membership.workspaceId);
            entity.property(membership => membership.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(membership => membership.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(membership => membership.userId).hasColumnName('user_id').hasColumnType('text').isRequired();
            entity.property(membership => membership.role).hasColumnName('role').hasColumnType('text').hasConversion(enumString<MembershipRole>()).isRequired();
            entity.property(membership => membership.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.ignore(membership => membership.workspace);
            entity.ignore(membership => membership.user);
            entity.hasOne(TrialWorkspace, membership => membership.workspace)
                .withMany()
                .hasForeignKey(membership => membership.workspaceId);
            entity.hasOne(TrialUser, membership => membership.user)
                .withMany(user => user.memberships)
                .hasForeignKey(membership => membership.userId);
            entity.hasIndex(membership => [membership.workspaceId, membership.userId]).isUnique().hasDatabaseName('ux_trial_memberships_workspace_user');
        });

        model.entity(TrialLink, entity => {
            entity.toTable('trial_links');
            entity.hasKey(link => link.id);
            entity.tenantKey(link => link.workspaceId);
            entity.softDelete(link => link.archivedAt);
            entity.property(link => link.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(link => link.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(link => link.creatorId).hasColumnName('creator_id').hasColumnType('text').isRequired();
            entity.property(link => link.slug).hasColumnName('slug').hasColumnType('text').isRequired();
            entity.property(link => link.url).hasColumnName('url').hasColumnType('text').isRequired();
            entity.property(link => link.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(link => link.archivedAt).hasColumnName('archived_at').hasColumnType('timestamptz').isOptional();
            entity.property(link => link.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.ignore(link => link.workspace);
            entity.ignore(link => link.creator);
            entity.ignore(link => link.tags);
            entity.ignore(link => link.events);
            entity.hasOne(TrialWorkspace, link => link.workspace)
                .withMany(workspace => workspace.links)
                .hasForeignKey(link => link.workspaceId);
            entity.hasOne(TrialUser, link => link.creator)
                .withMany()
                .hasForeignKey(link => link.creatorId);
            entity.hasManyToMany(TrialTag, link => link.tags)
                .withMany(tag => tag.links)
                .usingJoinTable('trial_link_tags', join => {
                    join.sourceForeignKey('link_id');
                    join.targetForeignKey('tag_id');
                });
            entity.hasIndex(link => [link.workspaceId, link.slug]).isUnique().hasDatabaseName('ux_trial_links_workspace_slug');
            entity.hasIndex(link => [link.workspaceId, link.createdAt]).hasDatabaseName('ix_trial_links_workspace_created');
        });

        model.entity(TrialTag, entity => {
            entity.toTable('trial_tags');
            entity.hasKey(tag => tag.id);
            entity.tenantKey(tag => tag.workspaceId);
            entity.property(tag => tag.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(tag => tag.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(tag => tag.slug).hasColumnName('slug').hasColumnType('text').isRequired();
            entity.property(tag => tag.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.ignore(tag => tag.links);
            entity.hasIndex(tag => [tag.workspaceId, tag.slug]).isUnique().hasDatabaseName('ux_trial_tags_workspace_slug');
        });

        model.entity(TrialEvent, entity => {
            entity.toTable('trial_events');
            entity.hasKey(event => event.id);
            entity.tenantKey(event => event.workspaceId);
            entity.property(event => event.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(event => event.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(event => event.linkId).hasColumnName('link_id').hasColumnType('text').isRequired();
            entity.property(event => event.eventType).hasColumnName('event_type').hasColumnType('text').isRequired();
            entity.property(event => event.country).hasColumnName('country').hasColumnType('text').isOptional();
            entity.property(event => event.occurredAt).hasColumnName('occurred_at').hasColumnType('timestamptz').isRequired();
            entity.ignore(event => event.link);
            entity.hasOne(TrialLink, event => event.link)
                .withMany(link => link.events)
                .hasForeignKey(event => event.linkId);
            entity.hasIndex(event => [event.workspaceId, event.occurredAt]).hasDatabaseName('ix_trial_events_workspace_occurred');
        });

        model.entity(TrialSubscription, entity => {
            entity.toTable('trial_subscriptions');
            entity.hasKey(subscription => subscription.id);
            entity.tenantKey(subscription => subscription.workspaceId);
            entity.property(subscription => subscription.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(subscription => subscription.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(subscription => subscription.plan).hasColumnName('plan').hasColumnType('text').hasConversion(enumString<SubscriptionPlan>()).isRequired();
            entity.property(subscription => subscription.monthlyCents).hasColumnName('monthly_cents').hasColumnType('integer').isRequired();
            entity.property(subscription => subscription.activeAt).hasColumnName('active_at').hasColumnType('timestamptz').isRequired();
            entity.property(subscription => subscription.canceledAt).hasColumnName('canceled_at').hasColumnType('timestamptz').isOptional();
            entity.ignore(subscription => subscription.workspace);
            entity.hasOne(TrialWorkspace, subscription => subscription.workspace)
                .hasForeignKey(subscription => subscription.workspaceId);
        });

        model.entity(TrialInvoice, entity => {
            entity.toTable('trial_invoices');
            entity.hasKey(invoice => invoice.id);
            entity.tenantKey(invoice => invoice.workspaceId);
            entity.property(invoice => invoice.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(invoice => invoice.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(invoice => invoice.subscriptionId).hasColumnName('subscription_id').hasColumnType('text').isRequired();
            entity.property(invoice => invoice.status).hasColumnName('status').hasColumnType('text').hasConversion(enumString<InvoiceStatus>()).isRequired();
            entity.property(invoice => invoice.totalCents).hasColumnName('total_cents').hasColumnType('integer').isRequired();
            entity.property(invoice => invoice.dueAt).hasColumnName('due_at').hasColumnType('timestamptz').isRequired();
            entity.property(invoice => invoice.paidAt).hasColumnName('paid_at').hasColumnType('timestamptz').isOptional();
            entity.ignore(invoice => invoice.workspace);
            entity.ignore(invoice => invoice.subscription);
            entity.hasOne(TrialWorkspace, invoice => invoice.workspace)
                .hasForeignKey(invoice => invoice.workspaceId);
            entity.hasOne(TrialSubscription, invoice => invoice.subscription)
                .hasForeignKey(invoice => invoice.subscriptionId);
            entity.hasIndex(invoice => [invoice.workspaceId, invoice.status]).hasDatabaseName('ix_trial_invoices_workspace_status');
        });
    }
}

export function createTrialDb(): TrialDbContext {
    TrialDbContext.connection = new RecordingDatabaseConnection();
    return TrialDbContext.create();
}
