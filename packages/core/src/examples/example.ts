import { AppDbContext } from './app-db-context';
import { Post } from './post';
import { User } from './user';

export async function runExample(): Promise<void> {
    const db =  AppDbContext.create();

    try {
        db.users.add(new User({
            id: 'usr_1',
            email: 'ada@example.com',
            name: 'Ada',
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        await db.saveChanges();

        const user = await db.users
            .where(u => u.email.eq('ada@example.com'))
            .single();

        user.name = 'Ada Lovelace';

        db.posts.add(new Post({
            id: 'post_1',
            title: 'Entity Framework but TypeScript',
            authorId: user.id,
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        console.log(db.changeTracker.debugView());

        await db.saveChanges();
    } finally {
        await db.dispose();
    }
}
