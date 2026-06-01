import type { AppUser } from './app-user';
import type { Project } from './project';
import type { TaskComment } from './task-comment';

export type TaskStatus = 'todo' | 'doing' | 'done';

export class TaskItem {
    public id!: string;
    public workspaceId!: string;
    public projectId!: string;
    public assigneeId?: string | null;
    public title!: string;
    public status!: TaskStatus;
    public createdAt!: Date;
    public updatedAt!: Date;
    public deletedAt?: Date | null;
    public project!: Project;
    public assignee?: AppUser | null;
    public comments!: TaskComment[];

    constructor(data?: Partial<TaskItem>) {
        Object.assign(this, data);
    }
}
