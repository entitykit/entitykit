import { DbContext } from '../../core/db-context';
import type { DbContextOptionsBuilder } from '../../core/context-options/db-context-options-builder';
import type { ModelBuilder } from '../../model/model-builder';
import { DeleteBehavior } from '../../model/relationship-metadata';
import { enumString } from '../../model/value-converter/enum-string';
import { AppUser } from './app-user';
import { Project } from './project';
import { TaskComment } from './task-comment';
import { TaskItem, type TaskStatus } from './task-item';
import { Workspace } from './workspace';
import type { OutboxMessage } from '../../core/outbox-options';

export class CrudAppDbContext extends DbContext {
    public workspaces = this.set(Workspace);
    public users = this.set(AppUser);
    public projects = this.set(Project);
    public tasks = this.set(TaskItem);
    public comments = this.set(TaskComment);

    protected override configure(options: DbContextOptionsBuilder): void {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error(
                'DATABASE_URL is required to configure CrudAppDbContext.',
            );
        }
        options
            .usePostgres(connectionString)
            .useAuditing()
            .useTenantScope(() => process.env.WORKSPACE_ID)
            .useOutbox({
                collectEvents: collectDomainEvents,
                clearEvents: clearDomainEvents,
            });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Workspace, entity => {
            entity.toTable('workspaces');
            entity.hasKey(workspace => workspace.id);
            entity.property(workspace => workspace.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(workspace => workspace.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(workspace => workspace.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.property(workspace => workspace.updatedAt).hasColumnName('updated_at').hasColumnType('timestamptz').isRequired();
        });

        model.entity(AppUser, entity => {
            entity.toTable('app_users');
            entity.hasKey(user => user.id);
            entity.tenantKey(user => user.workspaceId);
            entity.audit({ createdAt: user => user.createdAt, updatedAt: user => user.updatedAt });
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(user => user.displayName).hasColumnName('display_name').hasColumnType('text').isRequired();
            entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.property(user => user.updatedAt).hasColumnName('updated_at').hasColumnType('timestamptz').isRequired();
            entity.hasIndex(user => [user.workspaceId, user.email]).hasDatabaseName('ux_app_users_workspace_email').isUnique();
        });

        model.entity(Project, entity => {
            entity.toTable('projects');
            entity.hasKey(project => project.id);
            entity.tenantKey(project => project.workspaceId);
            entity.audit({ createdAt: project => project.createdAt, updatedAt: project => project.updatedAt });
            entity.property(project => project.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(project => project.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(project => project.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(project => project.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.property(project => project.updatedAt).hasColumnName('updated_at').hasColumnType('timestamptz').isRequired();
            entity.hasOne(Workspace, project => project.workspace)
                .withMany(workspace => workspace.projects)
                .hasForeignKey(project => project.workspaceId)
                .onDelete(DeleteBehavior.Cascade);
        });

        model.entity(TaskItem, entity => {
            entity.toTable('tasks');
            entity.hasKey(task => task.id);
            entity.tenantKey(task => task.workspaceId);
            entity.softDelete(task => task.deletedAt);
            entity.audit({ createdAt: task => task.createdAt, updatedAt: task => task.updatedAt });
            entity.property(task => task.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(task => task.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(task => task.projectId).hasColumnName('project_id').hasColumnType('text').isRequired();
            entity.property(task => task.assigneeId).hasColumnName('assignee_id').hasColumnType('text').isOptional();
            entity.property(task => task.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(task => task.status).hasColumnName('status').hasColumnType('text').hasConversion(enumString<TaskStatus>()).isRequired();
            entity.property(task => task.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.property(task => task.updatedAt).hasColumnName('updated_at').hasColumnType('timestamptz').isRequired();
            entity.property(task => task.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz').isOptional();
            entity.hasOne(Project, task => task.project)
                .withMany(project => project.tasks)
                .hasForeignKey(task => task.projectId)
                .onDelete(DeleteBehavior.NoAction);
            entity.hasOne(AppUser, task => task.assignee)
                .withMany(user => user.assignedTasks)
                .hasForeignKey(task => task.assigneeId)
                .onDelete(DeleteBehavior.SetNull);
            entity.hasIndex(task => [task.workspaceId, task.status]).hasDatabaseName('ix_tasks_workspace_status');
        });

        model.entity(TaskComment, entity => {
            entity.toTable('task_comments');
            entity.hasKey(comment => comment.id);
            entity.tenantKey(comment => comment.workspaceId);
            entity.property(comment => comment.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(comment => comment.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(comment => comment.taskId).hasColumnName('task_id').hasColumnType('text').isRequired();
            entity.property(comment => comment.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
            entity.property(comment => comment.body).hasColumnName('body').hasColumnType('text').isRequired();
            entity.property(comment => comment.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.hasOne(TaskItem, comment => comment.task)
                .withMany(task => task.comments)
                .hasForeignKey(comment => comment.taskId)
                .onDelete(DeleteBehavior.Cascade);
            entity.hasOne(AppUser, comment => comment.author)
                .withMany()
                .hasForeignKey(comment => comment.authorId)
                .onDelete(DeleteBehavior.NoAction);
        });
    }
}

function collectDomainEvents(entity: object): readonly OutboxMessage[] {
    const events = 'domainEvents' in entity
        ? (entity as { domainEvents?: unknown }).domainEvents
        : undefined;
    return Array.isArray(events) ? events as OutboxMessage[] : [];
}

function clearDomainEvents(
    entity: object,
    persistedEvents: readonly OutboxMessage[],
): void {
    if (!('domainEvents' in entity)) {
        return;
    }
    const aggregate = entity as { domainEvents?: unknown };
    if (!Array.isArray(aggregate.domainEvents)) {
        return;
    }
    const persisted = new Set(persistedEvents);
    aggregate.domainEvents = aggregate.domainEvents.filter(
        event => !persisted.has(event as OutboxMessage),
    );
}
