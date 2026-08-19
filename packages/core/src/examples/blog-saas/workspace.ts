import type { BlogPost } from './blog-post';
import type { Membership } from './membership';

export class Workspace {
    public id!: string;
    public slug!: string;
    public name!: string;
    public createdAt!: Date;
    public memberships: Membership[] = [];
    public posts: BlogPost[] = [];

    constructor(data?: Partial<Workspace>) {
        Object.assign(this, data);
    }
}
