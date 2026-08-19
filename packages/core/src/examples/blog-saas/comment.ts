import type { BlogPost } from './blog-post';

export class Comment {
    public id!: string;
    public postId!: string;
    public authorName!: string;
    public body!: string;
    public createdAt!: Date;
    public post?: BlogPost;

    constructor(data?: Partial<Comment>) {
        Object.assign(this, data);
    }
}
