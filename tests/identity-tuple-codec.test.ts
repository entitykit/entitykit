import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    ValueConverter,
} from '../src';
import { DbContext, EntityState, valueConverter } from '../src';
import { encodeIdentityTuple } from '../src/model/identity-value';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

describe('identity tuple codec', () => {
    it('type-tags bigint and composite key components', () => {
        expect(encodeIdentityTuple([1n])).toBe(
            '["entitykit:identity:v1",["bigint","1"]]',
        );
        expect(encodeIdentityTuple([1n, 'tenant-a'])).toBe(
            '["entitykit:identity:v1",["bigint","1"],["string","tenant-a"]]',
        );
    });

    it('distinguishes otherwise ambiguous scalar key types', () => {
        expect(new Set([
            encodeIdentityTuple(['1']),
            encodeIdentityTuple([1]),
            encodeIdentityTuple([1n]),
            encodeIdentityTuple([true]),
        ])).toHaveProperty('size', 4);
    });

    it('encodes dates and binary keys deterministically', () => {
        expect(encodeIdentityTuple([
            new Date('2026-08-05T12:34:56.000Z'),
            new Uint8Array([0, 127, 255]),
        ])).toBe(
            '["entitykit:identity:v1",["date","2026-08-05T12:34:56.000Z"],["bytes","0x007fff"]]',
        );
    });
});

class BigIntPost {
    public id!: bigint;
    public title!: string;
    public tags: BigIntTag[] = [];
}

class BigIntTag {
    public id!: bigint;
    public name!: string;
    public posts: BigIntPost[] = [];
}

class BigIntManyToManyContext extends DbContext {
    public posts = this.set(BigIntPost);
    public tags = this.set(BigIntTag);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(BigIntPost, entity => {
            entity.toTable('bigint_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnType('bigint').isRequired();
            entity.property(post => post.title).hasColumnType('text').isRequired();
            entity.hasManyToMany(BigIntTag, post => post.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('bigint_post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(BigIntTag, entity => {
            entity.toTable('bigint_tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnType('bigint').isRequired();
            entity.property(tag => tag.name).hasColumnType('text').isRequired();
        });
    }
}

describe('bigint many-to-many save plans', () => {
    it('coalesces link and unlink requests without JSON bigint failures', () => {
        const connection = new RecordingDatabaseConnection();
        const db = BigIntManyToManyContext.create(connection);
        const post = Object.assign(new BigIntPost(), {
            id: 1n,
            title: 'post',
        });
        const tag = Object.assign(new BigIntTag(), { id: 2n, name: 'tag' });
        db.posts.attach(post);
        db.tags.attach(tag);

        db.link(post, entity => entity.tags, tag);
        db.unlink(post, entity => entity.tags, tag);
        db.link(post, entity => entity.tags, tag);

        const plan = db.getSavePlan();
        expect(plan).toHaveLength(1);
        expect(plan[0]).toMatchObject({
            state: EntityState.Added,
            statement: { values: [1n, 2n] },
        });
    });
});

const convertedBigInt: ValueConverter<string, bigint> = valueConverter({
    toProvider: value => BigInt(value),
    fromProvider: value => value.toString(),
});

class ConvertedPost {
    public id!: string;
    public title!: string;
    public tags: ConvertedTag[] = [];
}

class ConvertedTag {
    public id!: string;
    public name!: string;
    public posts: ConvertedPost[] = [];
}

class ConvertedManyToManyContext extends DbContext {
    public posts = this.set(ConvertedPost);
    public tags = this.set(ConvertedTag);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ConvertedPost, entity => {
            entity.toTable('converted_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnType('bigint').isRequired()
                .hasConversion(convertedBigInt);
            entity.property(post => post.title).hasColumnType('text').isRequired();
            entity.hasManyToMany(ConvertedTag, post => post.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('converted_post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(ConvertedTag, entity => {
            entity.toTable('converted_tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnType('bigint').isRequired()
                .hasConversion(convertedBigInt);
            entity.property(tag => tag.name).hasColumnType('text').isRequired();
        });
    }
}

describe('converted bigint many-to-many save plans', () => {
    it('deduplicates provider bigint tuples after conversion', () => {
        const connection = new RecordingDatabaseConnection();
        const db = ConvertedManyToManyContext.create(connection);
        const post = Object.assign(new ConvertedPost(), {
            id: '10',
            title: 'post',
        });
        const tag = Object.assign(new ConvertedTag(), {
            id: '20',
            name: 'tag',
        });
        db.posts.attach(post);
        db.tags.attach(tag);

        db.link(post, entity => entity.tags, tag);
        db.link(post, entity => entity.tags, tag);

        expect(db.getSavePlan()[0]?.statement.values).toEqual([10n, 20n]);
    });
});
