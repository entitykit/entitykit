import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    ValueConverter,
} from '../src';
import { DbContext, valueConverter } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

abstract class UnstableKeyEntity {
    private key = 0;
    private keyReads = 0;
    private stableReads = Number.POSITIVE_INFINITY;

    public get id(): number {
        this.keyReads += 1;
        return this.keyReads <= this.stableReads ? this.key : this.key + 1;
    }

    public set id(value: number) {
        this.key = value;
    }

    public resetKeyReads(stableReads: number): void {
        this.keyReads = 0;
        this.stableReads = stableReads;
    }

    public get observedKeyReads(): number {
        return this.keyReads;
    }
}

class SnapshotPost extends UnstableKeyEntity {
    public title!: string;
    public tags: SnapshotTag[] = [];
}

class SnapshotTag extends UnstableKeyEntity {
    public name!: string;
    public posts: SnapshotPost[] = [];
}

class RelationshipSnapshotContext extends DbContext {
    public posts = this.set(SnapshotPost);
    public tags = this.set(SnapshotTag);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(SnapshotPost, entity => {
            entity.toTable('snapshot_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnType('integer').isRequired();
            entity.property(post => post.title).hasColumnType('text').isRequired();
            entity.hasManyToMany(SnapshotTag, post => post.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('snapshot_post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(SnapshotTag, entity => {
            entity.toTable('snapshot_tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnType('integer').isRequired();
            entity.property(tag => tag.name).hasColumnType('text').isRequired();
        });
    }
}

async function start(): Promise<RelationshipSnapshotContext> {
    const db = RelationshipSnapshotContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    for (const table of ['snapshot_posts', 'snapshot_tags']) {
        const label = table === 'snapshot_posts' ? 'title' : 'name';
        await db.database.connection.query({
            text: `insert into ${table} (id, ${label}) values (?, ?), (?, ?)`,
            values: [1, 'one', 2, 'two'],
        });
    }
    return db;
}

function endpoints(): { post: SnapshotPost; tag: SnapshotTag } {
    const post = Object.assign(new SnapshotPost(), { id: 1, title: 'one' });
    const tag = Object.assign(new SnapshotTag(), { id: 1, name: 'one' });
    return { post, tag };
}

describe('many-to-many executable endpoint snapshots', () => {
    it('links the rows represented by the captured endpoint keys', async () => {
        const db = await start();
        const { post, tag } = endpoints();
        db.posts.attach(post);
        db.tags.attach(tag);
        db.link(post, item => item.tags, tag);
        post.resetKeyReads(1);
        tag.resetKeyReads(1);

        await db.saveChanges();

        const rows = await db.database.connection.query<{
            post_id: number;
            tag_id: number;
        }>({
            text: 'select post_id, tag_id from snapshot_post_tags',
            values: [],
        });
        expect(rows.rows).toEqual([{ post_id: 1, tag_id: 1 }]);
        expect(post.observedKeyReads).toBe(1);
        expect(tag.observedKeyReads).toBe(1);
        await db.dispose();
    });

    it('unlinks the rows represented by the captured endpoint keys', async () => {
        const db = await start();
        await db.database.connection.query({
            text: 'insert into snapshot_post_tags (post_id, tag_id) values (?, ?), (?, ?)',
            values: [1, 1, 2, 2],
        });
        const { post, tag } = endpoints();
        post.tags = [tag];
        tag.posts = [post];
        db.posts.attach(post);
        db.tags.attach(tag);
        db.unlink(post, item => item.tags, tag);
        post.resetKeyReads(1);
        tag.resetKeyReads(1);

        await db.saveChanges();

        const rows = await db.database.connection.query<{
            post_id: number;
            tag_id: number;
        }>({
            text: 'select post_id, tag_id from snapshot_post_tags order by post_id',
            values: [],
        });
        expect(rows.rows).toEqual([{ post_id: 2, tag_id: 2 }]);
        expect(post.observedKeyReads).toBe(1);
        expect(tag.observedKeyReads).toBe(1);
        await db.dispose();
    });
});

class ConverterProbe {
    private stableReads = Number.POSITIVE_INFINITY;
    public reads = 0;

    public readonly converter: ValueConverter<string, number> = valueConverter({
        toProvider: value => {
            this.reads += 1;
            const converted = Number(value);
            return this.reads <= this.stableReads
                ? converted
                : converted + 1;
        },
        fromProvider: value => String(value),
    });

    public reset(stableReads: number): void {
        this.reads = 0;
        this.stableReads = stableReads;
    }
}

const postKeyConverter = new ConverterProbe();
const tagKeyConverter = new ConverterProbe();

class ConvertedSnapshotPost {
    public id!: string;
    public tenantId!: string;
    public tags: ConvertedSnapshotTag[] = [];
}

class ConvertedSnapshotTag {
    public id!: string;
    public posts: ConvertedSnapshotPost[] = [];
}

class ConvertedRelationshipSnapshotContext extends DbContext {
    public posts = this.set(ConvertedSnapshotPost);
    public tags = this.set(ConvertedSnapshotTag);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ConvertedSnapshotPost, entity => {
            entity.toTable('converted_snapshot_posts');
            entity.hasKey(post => [post.id, post.tenantId]);
            entity.property(post => post.id).hasColumnType('integer').isRequired()
                .hasConversion(postKeyConverter.converter);
            entity.property(post => post.tenantId).hasColumnType('text').isRequired();
            entity.hasManyToMany(ConvertedSnapshotTag, post => post.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('converted_snapshot_post_tags', join => {
                    join.sourceForeignKey(['post_id', 'tenant_id']);
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(ConvertedSnapshotTag, entity => {
            entity.toTable('converted_snapshot_tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnType('integer').isRequired()
                .hasConversion(tagKeyConverter.converter);
        });
    }
}

describe('many-to-many captured endpoint conversion', () => {
    it('converts each captured composite endpoint once for the whole plan', () => {
        const connection = new RecordingDatabaseConnection();
        const db = ConvertedRelationshipSnapshotContext.create(connection);
        const post = Object.assign(new ConvertedSnapshotPost(), {
            id: '1',
            tenantId: 'tenant-a',
        });
        const tag = Object.assign(new ConvertedSnapshotTag(), { id: '1' });
        db.posts.attach(post);
        db.tags.attach(tag);
        db.link(post, item => item.tags, tag);
        postKeyConverter.reset(4);
        tagKeyConverter.reset(4);

        const plan = db.getSavePlan();

        expect(plan[0]?.statement.values).toEqual([1, 'tenant-a', 1]);
        expect(postKeyConverter.reads).toBe(4);
        expect(tagKeyConverter.reads).toBe(4);
    });
});
