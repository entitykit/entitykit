import type { DbContextOptionsBuilder, ModelBuilder } from '../../src';
import { DbContext } from '../../src';
import { sqliteProviderServices } from '../../src/providers/sqlite';

export class GeneratedPost {
    public id = 0;
    public title = '';
    public tags: GeneratedTag[] = [];
}

export class GeneratedTag {
    public id = 0;
    public name = '';
    public posts: GeneratedPost[] = [];
}

export class GeneratedManyToManyContext extends DbContext {
    public posts = this.set(GeneratedPost);
    public tags = this.set(GeneratedTag);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedPost, entity => {
            entity.toTable('generated_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(post => post.title).hasColumnType('text').isRequired();
            entity.hasManyToMany(GeneratedTag, post => post.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('generated_post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(GeneratedTag, entity => {
            entity.toTable('generated_tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(tag => tag.name).hasColumnType('text').isRequired();
        });
    }
}

export async function startGeneratedManyToManyContext(
): Promise<GeneratedManyToManyContext> {
    const db = GeneratedManyToManyContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    await db.database.connection.query({
        text: 'insert into generated_posts (id, title) values (?, ?)',
        values: [0, 'existing-post'],
    });
    await db.database.connection.query({
        text: 'insert into generated_tags (id, name) values (?, ?)',
        values: [0, 'existing-tag'],
    });
    return db;
}
