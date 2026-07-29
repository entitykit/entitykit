import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, DeleteBehavior, enumString } from '../src';
import { contextMigrations } from '../src/migrations/api';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class User {
    public id!: string;
    public email!: string;
    public posts!: Post[];
    public displayName!: string;
}

class Post {
    public id!: string;
    public authorId!: string;
    public author!: User;
    public status!: 'Draft' | 'Published';
}

class SnapshotContext extends DbContext {
    public static connection = new RecordingDatabaseConnection();

    public users = this.set(User);
    public posts = this.set(Post);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(SnapshotContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users', 'app');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('uuid').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').hasMaxLength(255).isUnique().isRequired();
            entity.ignore(user => user.displayName);
            entity.hasIndex(user => user.email).hasDatabaseName('ux_users_email').isUnique();
        });

        model.entity(Post, entity => {
            entity.toTable('posts', 'app');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('uuid').isRequired();
            entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('uuid').isRequired();
            entity.property(post => post.status)
                .hasColumnName('status')
                .hasColumnType('text')
                .hasDefaultValue('Draft')
                .hasConversion(enumString<'Draft' | 'Published'>())
                .isRequired();
            entity.hasOne(User, post => post.author)
                .withMany(user => user.posts)
                .hasForeignKey(post => post.authorId)
                .onDelete(DeleteBehavior.Cascade)
                .hasConstraintName('fk_posts_users_author_id');
        });
    }
}

describe('model snapshots', () => {
    it('creates a deterministic JSON-serializable model snapshot', () => {
        const db =  SnapshotContext.create();

        const snapshot = contextMigrations(db).createModelSnapshot();

        expect(snapshot).toMatchObject({
            formatVersion: 1,
            entities: [
                {
                    entityName: 'Post',
                    tableName: 'posts',
                    schemaName: 'app',
                    keyProperty: 'id',
                    properties: [
                        { propertyName: 'id', columnName: 'id', columnType: 'uuid', isPrimaryKey: true },
                        { propertyName: 'authorId', columnName: 'author_id', columnType: 'uuid' },
                        { propertyName: 'status', columnName: 'status', hasConverter: true, defaultValue: 'Draft' },
                    ],
                    relationships: [
                        {
                            navigationProperty: 'author',
                            principalEntityName: 'User',
                            inverseNavigationProperty: 'posts',
                            foreignKeyProperty: 'authorId',
                            deleteBehavior: 'cascade',
                            constraintName: 'fk_posts_users_author_id',
                        },
                    ],
                },
                {
                    entityName: 'User',
                    tableName: 'users',
                    schemaName: 'app',
                    keyProperty: 'id',
                    ignoredProperties: ['displayName'],
                    indexes: [
                        { propertyNames: ['email'], isUnique: true, databaseName: 'ux_users_email' },
                        { propertyNames: ['email'], isUnique: true },
                    ],
                },
            ],
        });

        expect(() => JSON.stringify(snapshot)).not.toThrow();
    });
});
