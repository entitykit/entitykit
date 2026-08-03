import type { DbContextOptionsBuilder, ModelBuilder } from '../../src';
import { DbContext } from '../../src';
import { RecordingDatabaseConnection } from './recording-database-connection';

export class User {
    public id!: string;
    public email!: string;
    public name!: string;
    public createdAt!: Date;
    public updatedAt!: Date;

    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
}

export class Post {
    public id!: string;
    public title!: string;
    public authorId!: string;
    public createdAt!: Date;
    public updatedAt!: Date;

    constructor(data?: Partial<Post>) {
        Object.assign(this, data);
    }
}

class AppDbContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public static auditing?: { now: () => Date; currentUserId: () => unknown };

    public users = this.set(User);
    public posts = this.set(Post);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(AppDbContext.connection);
        if (AppDbContext.auditing) {
            options.useAuditing(AppDbContext.auditing);
        }
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(user => user.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.property(user => user.updatedAt).hasColumnName('updated_at').hasColumnType('timestamptz').isRequired();
        });

        model.entity(Post, entity => {
            entity.toTable('posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
            entity.property(post => post.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.property(post => post.updatedAt).hasColumnName('updated_at').hasColumnType('timestamptz').isRequired();
        });
    }
}

export function createSaveChangesDb(
    connection = new RecordingDatabaseConnection(),
    auditing?: { now: () => Date; currentUserId: () => unknown },
): AppDbContext {
    AppDbContext.connection = connection;
    AppDbContext.auditing = auditing;
    return AppDbContext.create();
}
