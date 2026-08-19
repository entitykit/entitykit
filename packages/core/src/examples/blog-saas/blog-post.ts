import type { BlogUser } from './blog-user';
import type { Comment } from './comment';
import type { Tag } from './tag';
import type { Workspace } from './workspace';

export class BlogPost {
    public id!: string;
    public workspaceId!: string;
    public authorId!: string;
    public title!: string;
    public slug!: string;
    public body!: string;
    public publishedAt!: Date | null;
    public createdAt!: Date;
    public updatedAt!: Date;
    public workspace?: Workspace;
    public author?: BlogUser;
    public comments: Comment[] = [];
    public tags: Tag[] = [];

    constructor(data?: Partial<BlogPost>) {
        Object.assign(this, data);
    }
}
