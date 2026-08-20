import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    SaveChangesInterceptor,
} from '../../packages/core/src';
import { DbContext } from '../../packages/core/src';
import { sqliteProviderServices } from '../../packages/sqlite/src';

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

    constructor(private readonly interceptor?: SaveChangesInterceptor) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
        if (this.interceptor) {
            options.useSaveInterceptor(this.interceptor);
        }
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
    interceptor?: SaveChangesInterceptor,
): Promise<GeneratedManyToManyContext> {
    const db = GeneratedManyToManyContext.create(interceptor);
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
