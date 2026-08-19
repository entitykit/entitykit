import type { AppUser } from './app-user';
import type { TaskItem } from './task-item';

export class TaskComment {
    public id!: string;
    public workspaceId!: string;
    public taskId!: string;
    public authorId!: string;
    public body!: string;
    public createdAt!: Date;
    public task!: TaskItem;
    public author!: AppUser;

    constructor(data?: Partial<TaskComment>) {
        Object.assign(this, data);
    }
}
