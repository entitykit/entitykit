import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, DeleteBehavior } from '../packages/core/src';
import { contextMigrations, diffModelSnapshots } from '../packages/core/src/migrations/api';
import { sqliteProviderServices } from '../packages/sqlite/src';

/**
 * Default index and foreign-key names describe the database, so they are built
 * from column names. Built from property names they named nothing a reader
 * could find in the database — and, worse, made a pure TypeScript rename
 * produce a schema migration.
 */
class Owner {
    public id!: string;
    constructor(data?: Partial<Owner>) {
        Object.assign(this, data);
    }
}

class WithAuthorId {
    public id!: string;
    public authorId!: string;
    public createdAt!: Date;
    public owner?: Owner;
    constructor(data?: Partial<WithAuthorId>) {
        Object.assign(this, data);
    }
}

/** The same table, column for column. Only the TypeScript name differs. */
class WithWriterId {
    public id!: string;
    public writerId!: string;
    public createdAt!: Date;
    public owner?: Owner;
    constructor(data?: Partial<WithWriterId>) {
        Object.assign(this, data);
    }
}

function contextFor(which: 'author' | 'writer'): { create(): DbContext } {
    return class NamingDbContext extends DbContext {
        public a = this.set(WithAuthorId);
        public b = this.set(WithWriterId);

        protected override configure(options: DbContextOptionsBuilder): void {
            options.useProvider(sqliteProviderServices, ':memory:');
        }

        protected override model(model: ModelBuilder): void {
            model.entity(Owner, entity => {
                entity.toTable('owners');
                entity.hasKey(owner => owner.id);
                entity.property(owner => owner.id).hasColumnName('id').hasColumnType('text').isRequired();
            });

            if (which === 'author') {
                model.entity(WithAuthorId, entity => {
                    entity.toTable('posts');
                    entity.hasKey(post => post.id);
                    entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
                    entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
                    entity.property(post => post.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
                    entity.hasIndex(post => [post.authorId, post.createdAt]);
                    entity.hasOne(Owner, post => post.owner).hasForeignKey(post => post.authorId).onDelete(DeleteBehavior.Cascade);
                });
            } else {
                model.entity(WithWriterId, entity => {
                    entity.toTable('posts');
                    entity.hasKey(post => post.id);
                    entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
                    entity.property(post => post.writerId).hasColumnName('author_id').hasColumnType('text').isRequired();
                    entity.property(post => post.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
                    entity.hasIndex(post => [post.writerId, post.createdAt]);
                    entity.hasOne(Owner, post => post.owner).hasForeignKey(post => post.writerId).onDelete(DeleteBehavior.Cascade);
                });
            }
        }
    };
}

const empty = { version: 1, entities: [] } as unknown as Parameters<typeof diffModelSnapshots>[0];

describe('default object naming', () => {
    it('names indexes and foreign keys after their columns', async () => {
        const db =  contextFor('author').create();
        const operations = diffModelSnapshots(empty, contextMigrations(db).createModelSnapshot()).operations;

        const index = operations.find(operation => operation.kind === 'createIndex');
        expect(index).toMatchObject({ name: 'ix_posts_author_id_created_at' });

        // Scheme fk_<child>_<principal>_<column>, matching what createSchemaScript
        // creates so a later migration references the same constraint.
        const foreignKey = operations.find(operation => operation.kind === 'addForeignKey');
        expect(foreignKey).toMatchObject({ name: 'fk_posts_owners_author_id' });

        await db.dispose();
    });

    it('produces no migration when only a property name changes', async () => {
    // The whole point. Two models describing the same table, column for column,
    // differing only in TypeScript. Before the fix this generated a drop and a
    // recreate of the index, and a drop and re-add of the foreign key.
        const author =  contextFor('author').create();
        const writer =  contextFor('writer').create();

        const diff = diffModelSnapshots(
            contextMigrations(author).createModelSnapshot(),
            contextMigrations(writer).createModelSnapshot(),
        );

        expect(diff.operations).toEqual([]);
        expect(diff.hasChanges).toBe(false);

        await author.dispose();
        await writer.dispose();
    });

    it('still honours an explicitly configured name', async () => {
        class Explicit {
            public id!: string;
            public authorId!: string;
            constructor(data?: Partial<Explicit>) {
                Object.assign(this, data);
            }
        }

        class ExplicitDbContext extends DbContext {
            public rows = this.set(Explicit);

            protected override configure(options: DbContextOptionsBuilder): void {
                options.useProvider(sqliteProviderServices, ':memory:');
            }

            protected override model(model: ModelBuilder): void {
                model.entity(Explicit, entity => {
                    entity.toTable('explicit');
                    entity.hasKey(row => row.id);
                    entity.property(row => row.id).hasColumnName('id').hasColumnType('text').isRequired();
                    entity.property(row => row.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
                    entity.hasIndex(row => row.authorId).hasDatabaseName('my_index');
                });
            }
        }

        const db =  ExplicitDbContext.create();
        const index = diffModelSnapshots(empty, contextMigrations(db).createModelSnapshot()).operations
            .find(operation => operation.kind === 'createIndex');

        expect(index).toMatchObject({ name: 'my_index' });
        await db.dispose();
    });
});
