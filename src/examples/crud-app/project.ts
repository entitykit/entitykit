import type { Workspace } from './workspace';
import type { TaskItem } from './task-item';

export class Project {
    public id!: string;
    public workspaceId!: string;
    public name!: string;
    public createdAt!: Date;
    public updatedAt!: Date;
    public workspace!: Workspace;
    public tasks!: TaskItem[];

    constructor(data?: Partial<Project>) {
        Object.assign(this, data);
    }
}
