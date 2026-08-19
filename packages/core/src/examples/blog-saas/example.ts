import { BlogPost } from './blog-post';
import { BlogSaasDbContext } from './blog-saas-db-context';
import { BlogUser } from './blog-user';
import { Membership } from './membership';
import { Workspace } from './workspace';

export async function runBlogSaasExample(): Promise<void> {
    const db =  BlogSaasDbContext.create();

    try {
        const now = new Date();

        db.workspaces.add(new Workspace({
            id: 'wrk_1',
            slug: 'acme',
            name: 'Acme',
            createdAt: now,
        }));

        db.users.add(new BlogUser({
            id: 'usr_1',
            email: 'ada@example.com',
            displayName: 'Ada Lovelace',
            createdAt: now,
        }));

        db.memberships.add(new Membership({
            id: 'mem_1',
            workspaceId: 'wrk_1',
            userId: 'usr_1',
            role: 'owner',
            createdAt: now,
        }));

        db.posts.add(new BlogPost({
            id: 'post_1',
            workspaceId: 'wrk_1',
            authorId: 'usr_1',
            title: 'EntityKit for SaaS blogs',
            slug: 'entitykit-for-saas-blogs',
            body: 'A small example showing a workspace-aware blog model.',
            publishedAt: now,
            createdAt: now,
            updatedAt: now,
        }));

        await db.saveChanges();

        const postSummaries = await db.posts
            .where(post => post.workspaceId.eq('wrk_1').and(post.publishedAt.isNotNull()))
            .orderByDescending(post => post.createdAt)
            .select(post => ({
                id: post.id,
                title: post.title,
                slug: post.slug,
                publishedAt: post.publishedAt,
            }))
            .take(10)
            .toArray();

        console.log(postSummaries);
    } finally {
        await db.dispose();
    }
}
