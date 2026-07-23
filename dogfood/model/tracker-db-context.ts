import type {
    DbContextOptionsBuilder,
    ModelBuilder } from '../../src';
import {
    DbContext,
    DeleteBehavior,
    enumString,
    numericAsString,
} from '../../src';
import type { DatabaseProviderServices } from '../../src/adapter';
import { Comment, Issue, Label, Member, Organization, Project, type IssueStatus } from './entities';

export interface TrackerOptions {
    readonly provider: DatabaseProviderServices;
    readonly connection: string;
    /** Tenant the context is scoped to; every query is filtered by it. */
    readonly currentOrganizationId: () => string;
    readonly currentMemberId?: () => string;
    readonly now?: () => Date;
    /** Enable `lazy(entity)` for this context. Off unless a scenario asks for it. */
    readonly lazyLoading?: { readonly maxPerContext?: number };
}

/**
 * The application's unit of work.
 *
 * Configured the way a real multi-tenant product would be: tenant scoping and
 * soft delete as query filters, audit fields populated on save, and optimistic
 * concurrency on the entity users edit concurrently.
 */
export class TrackerDbContext extends DbContext {
    public organizations = this.set(Organization);
    public members = this.set(Member);
    public projects = this.set(Project);
    public issues = this.set(Issue);
    public comments = this.set(Comment);
    public labels = this.set(Label);

    constructor(private readonly trackerOptions: TrackerOptions) {
        super();
    }

    public static open(options: TrackerOptions): TrackerDbContext {
        const context = TrackerDbContext.create(options);
        return context;
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(this.trackerOptions.provider, this.trackerOptions.connection);
        options.useTenantScope(this.trackerOptions.currentOrganizationId);
        options.useAuditing({
            now: this.trackerOptions.now,
            currentUserId: this.trackerOptions.currentMemberId,
        });
        if (this.trackerOptions.lazyLoading) {
            options.useLazyLoading(this.trackerOptions.lazyLoading);
        }
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Organization, entity => {
            entity.toTable('organizations');
            entity.hasKey(organization => organization.id);
            entity.property(organization => organization.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(organization => organization.slug).hasColumnName('slug').hasColumnType('text').isRequired().isUnique();
            entity.property(organization => organization.name).hasColumnName('name').hasColumnType('text').isRequired();
        });

        model.entity(Member, entity => {
            entity.toTable('members');
            entity.hasKey(member => member.id);
            entity.tenantKey(member => member.organizationId);
            entity.property(member => member.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(member => member.organizationId).hasColumnName('organization_id').hasColumnType('text').isRequired();
            entity.property(member => member.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(member => member.displayName).hasColumnName('display_name').hasColumnType('text').isRequired();
            entity.property(member => member.lastSeenAt).hasColumnName('last_seen_at').hasColumnType('timestamptz');
            entity.hasIndex(member => [member.organizationId, member.email]).isUnique();
        });

        model.entity(Project, entity => {
            entity.toTable('projects');
            entity.hasKey(project => project.id);
            entity.tenantKey(project => project.organizationId);
            entity.property(project => project.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(project => project.organizationId).hasColumnName('organization_id').hasColumnType('text').isRequired();
            entity.property(project => project.key).hasColumnName('key').hasColumnType('text').isRequired();
            entity.property(project => project.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(project => project.archivedAt).hasColumnName('archived_at').hasColumnType('timestamptz');
            entity.hasIndex(project => [project.organizationId, project.key]).isUnique();
        });

        model.entity(Issue, entity => {
            entity.toTable('issues');
            entity.hasKey(issue => issue.id);
            entity.tenantKey(issue => issue.organizationId);
            // Closed-out issues are hidden from every query unless explicitly asked for.
            entity.softDelete(issue => issue.deletedAt);
            entity.audit({ createdAt: 'createdAt', updatedAt: 'updatedAt' });
            entity.property(issue => issue.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(issue => issue.organizationId).hasColumnName('organization_id').hasColumnType('text').isRequired();
            entity.property(issue => issue.projectId).hasColumnName('project_id').hasColumnType('text').isRequired();
            entity.property(issue => issue.number).hasColumnName('number').hasColumnType('integer').isRequired();
            entity.property(issue => issue.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(issue => issue.status).hasColumnName('status').hasColumnType('text').isRequired()
                .hasConversion(enumString<IssueStatus>());
            entity.property(issue => issue.assigneeId).hasColumnName('assignee_id').hasColumnType('text');
            // numeric would come back as a string on Postgres and a number on SQLite
            // without this; the converter makes the model behave the same on both.
            entity.property(issue => issue.estimate).hasColumnName('estimate').hasColumnType('numeric')
                .hasConversion(numericAsString());
            entity.property(issue => issue.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.property(issue => issue.updatedAt).hasColumnName('updated_at').hasColumnType('timestamptz').isRequired();
            entity.property(issue => issue.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
            entity.property(issue => issue.version).hasColumnName('version').hasColumnType('integer').isRequired().isVersion();
            entity.hasIndex(issue => [issue.organizationId, issue.status]);

            entity.hasOne(Project, issue => issue.project)
                .withMany(project => project.issues)
                .hasForeignKey(issue => issue.projectId)
                .onDelete(DeleteBehavior.Cascade);
            entity.hasOne(Member, issue => issue.assignee)
                .hasForeignKey(issue => issue.assigneeId);
            entity.hasManyToMany(Label, issue => issue.labels)
                .withMany(label => label.issues)
                .usingJoinTable('issue_labels', join => {
                    join.sourceForeignKey('issue_id');
                    join.targetForeignKey('label_id');
                });
        });

        model.entity(Comment, entity => {
            entity.toTable('comments');
            entity.hasKey(comment => comment.id);
            entity.tenantKey(comment => comment.organizationId);
            entity.property(comment => comment.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(comment => comment.organizationId).hasColumnName('organization_id').hasColumnType('text').isRequired();
            entity.property(comment => comment.issueId).hasColumnName('issue_id').hasColumnType('text').isRequired();
            entity.property(comment => comment.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
            entity.property(comment => comment.body).hasColumnName('body').hasColumnType('text').isRequired();
            entity.property(comment => comment.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.hasOne(Issue, comment => comment.issue)
                .withMany(issue => issue.comments)
                .hasForeignKey(comment => comment.issueId)
                .onDelete(DeleteBehavior.Cascade);
        });

        model.entity(Label, entity => {
            entity.toTable('labels');
            entity.hasKey(label => label.id);
            entity.tenantKey(label => label.organizationId);
            entity.property(label => label.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(label => label.organizationId).hasColumnName('organization_id').hasColumnType('text').isRequired();
            entity.property(label => label.name).hasColumnName('name').hasColumnType('text').isRequired();
        });
    }
}
