import type { BlogPost } from './blog-post';
import type { Membership } from './membership';

export class BlogUser {
    public id!: string;
    public email!: string;
    public displayName!: string;
    public createdAt!: Date;
    public memberships: Membership[] = [];
    public posts: BlogPost[] = [];

    constructor(data?: Partial<BlogUser>) {
        Object.assign(this, data);
    }
}
