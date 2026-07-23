import { requireDefined } from '../support/require-defined';
import type { DbContextOptionsBuilder } from '../../src';
import { DbContext, type ModelBuilder } from '../../src';
import { mySqlProviderServices } from '../../src/providers/mysql';

const url = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const shouldRun = process.env.RUN_MYSQL_TESTS === 'true' && Boolean(url);
const maybe = shouldRun ? describe : describe.skip;

/**
 * A many-to-many link against live MySQL. The join insert appends the
 * do-nothing conflict clause, which used to hardcode `id = id` — a join table
 * has no `id`, so MySQL rejected every m2m insert at prepare time
 * (ER_UNKNOWN_COLUMN), even on the first link.
 */
class Tag {
    public id!: string;
    public name!: string;
    public posts: Post[] = [];
    constructor(data?: Partial<Tag>) {
        Object.assign(this, data);
    }
}

class Post {
    public id!: string;
    public title!: string;
    public tags: Tag[] = [];
    constructor(data?: Partial<Post>) {
        Object.assign(this, data);
    }
}

class M2MContext extends DbContext {
    public posts = this.set(Post);
    public tags = this.set(Tag);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(mySqlProviderServices, requireDefined(url));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Post, entity => {
            entity.toTable('m2m_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.hasManyToMany(Tag, post => post.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('m2m_post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(Tag, entity => {
            entity.toTable('m2m_tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(tag => tag.name).hasColumnName('name').hasColumnType('text').isRequired();
        });
    }
}

maybe('MySQL many-to-many links', () => {
    let db: M2MContext;

    const dropAll = async (): Promise<void> => {
        for (const table of ['m2m_post_tags', 'm2m_posts', 'm2m_tags']) {
            await db.database.connection.query({ text: `drop table if exists ${table}`, values: [] });
        }
    };

    const joinRowCount = async (): Promise<number> => {
        const result = await db.database.connection.query<{ c: number }>({ text: 'select count(*) as c from m2m_post_tags', values: [] });
        return result.rows[0]?.c;
    };

    beforeEach(async () => {
        db =  M2MContext.create();
        await dropAll();
        await db.database.connection.query({ text: db.database.createScript(), values: [] });
    });

    afterEach(async () => {
        await dropAll();
        await db.dispose();
    });

    it('links a post to a tag, idempotently', async () => {
        db.posts.add(new Post({ id: 'p1', title: 'Hello' }));
        db.tags.add(new Tag({ id: 't1', name: 'mysql' }));
        await db.saveChanges();
        db.changeTracker.clear();

        const post = await db.posts.find('p1');
        const tag = await db.tags.find('t1');
        db.link(requireDefined(post), p => p.tags, requireDefined(tag));
        // With the old hardcoded `id = id`, this insert alone threw at prepare time.
        await db.saveChanges();
        expect(await joinRowCount()).toBe(1);

        // Linking the same pair again hits the do-nothing clause on a real conflict.
        db.changeTracker.clear();
        const postAgain = await db.posts.find('p1');
        const tagAgain = await db.tags.find('t1');
        db.link(requireDefined(postAgain), p => p.tags, requireDefined(tagAgain));
        await db.saveChanges();
        expect(await joinRowCount()).toBe(1);
    });
});
