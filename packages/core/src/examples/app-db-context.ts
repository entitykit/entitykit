import { DbContext } from '../core/db-context';
import type { DbContextOptionsBuilder } from '../core/context-options/db-context-options-builder';
import type { ModelBuilder } from '../model/model-builder';
import { Post } from './post';
import { User } from './user';

export class AppDbContext extends DbContext {
    public users = this.set(User);
    public posts = this.set(Post);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.usePostgres(process.env.DATABASE_URL ?? 'postgres://localhost/entitykit_example');
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
