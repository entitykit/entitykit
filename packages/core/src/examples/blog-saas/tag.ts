import type { BlogPost } from './blog-post';
import type { Workspace } from './workspace';

export class Tag {
    public id!: string;
    public workspaceId!: string;
    public name!: string;
    public slug!: string;
    public posts: BlogPost[] = [];
    public workspace?: Workspace;

    constructor(data?: Partial<Tag>) {
        Object.assign(this, data);
    }
}
