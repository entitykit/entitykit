import type { Project } from './project';

export class Workspace {
    public id!: string;
    public name!: string;
    public createdAt!: Date;
    public updatedAt!: Date;
    public projects!: Project[];

    constructor(data?: Partial<Workspace>) {
        Object.assign(this, data);
    }
}
