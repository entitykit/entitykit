import type { TaskItem } from './task-item';

export class AppUser {
    public id!: string;
    public workspaceId!: string;
    public email!: string;
    public displayName!: string;
    public createdAt!: Date;
    public updatedAt!: Date;
    public assignedTasks!: TaskItem[];

    constructor(data?: Partial<AppUser>) {
        Object.assign(this, data);
    }
}
