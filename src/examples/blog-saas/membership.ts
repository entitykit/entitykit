import type { BlogUser } from './blog-user';
import type { Workspace } from './workspace';

export type MembershipRole = 'owner' | 'admin' | 'author' | 'reader';

export class Membership {
    public id!: string;
    public workspaceId!: string;
    public userId!: string;
    public role!: MembershipRole;
    public createdAt!: Date;
    public workspace?: Workspace;
    public user?: BlogUser;

    constructor(data?: Partial<Membership>) {
        Object.assign(this, data);
    }
}
