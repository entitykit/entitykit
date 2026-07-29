import type {
    DbContextOptionsBuilder,
    EntityConstructor,
    ModelBuilder,
} from '../../src';
import {
    DbContext,
    DeleteBehavior,
} from '../../src';
import { RecordingDatabaseConnection } from './recording-database-connection';

export class User {
    public id!: string;
    public cascadePosts!: RequiredPost[];
    public restrictedPosts!: RestrictPost[];
    public optionalPosts!: OptionalPost[];
    public optionalCascadePosts!: OptionalCascadePost[];
    public noActionPosts!: NoActionPost[];

    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
}

export class RequiredPost {
    public id!: string;
    public title!: string;
    public authorId!: string | null;
    public author!: User | null;

    constructor(data?: Partial<RequiredPost>) {
        Object.assign(this, data);
    }
}

export class RestrictPost {
    public id!: string;
    public authorId!: string;
    public author!: User;
}

export class OptionalPost {
    public id!: string;
    public authorId!: string | null;
    public author!: User | null;
}

export class OptionalCascadePost {
    public id!: string;
    public authorId!: string | null;
    public author!: User | null;
}

export class NoActionPost {
    public id!: string;
    public authorId!: string;
    public author!: User;
}

export class RelationshipContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public users = this.set(User);
    public requiredPosts = this.set(RequiredPost);
    public optionalPosts = this.set(OptionalPost);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(RelationshipContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        configureRelationshipModel(model);
    }
}

export function configureRelationshipModel(model: ModelBuilder): void {
    model.entity(User, entity => {
        entity.toTable('users');
        entity.hasKey(user => user.id);
        entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
    });

    configurePost(model, RequiredPost, 'required_posts', 'cascadePosts',
        DeleteBehavior.Cascade);
    configurePost(model, RestrictPost, 'restrict_posts', 'restrictedPosts',
        DeleteBehavior.Restrict);
    configurePost(model, OptionalPost, 'optional_posts', 'optionalPosts',
        DeleteBehavior.SetNull, true);
    configurePost(
        model,
        OptionalCascadePost,
        'optional_cascade_posts',
        'optionalCascadePosts',
        DeleteBehavior.Cascade,
        true,
    );
    configurePost(model, NoActionPost, 'no_action_posts', 'noActionPosts',
        DeleteBehavior.NoAction);
}

export function createRelationshipDb(
    connection = new RecordingDatabaseConnection(),
): RelationshipContext {
    RelationshipContext.connection = connection;
    return RelationshipContext.create();
}

interface RelationshipPost {
    id: string;
    title?: string;
    authorId: string | null;
    author: User | null;
}

function configurePost(
    model: ModelBuilder,
    ctor: EntityConstructor<RelationshipPost>,
    table: string,
    inverse: keyof User,
    behavior: DeleteBehavior,
    optional = false,
): void {
    model.entity(ctor, entity => {
        entity.toTable(table);
        entity.hasKey(post => post.id);
        entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
        if (table === 'required_posts') {
            entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
        }
        const foreignKey = entity.property(post => post.authorId)
            .hasColumnName('author_id')
            .hasColumnType('text');
        if (optional) {
            foreignKey.isOptional();
        } else {
            foreignKey.isRequired();
        }
        entity.hasOne(User, post => post.author)
            .withMany(user => user[inverse])
            .hasForeignKey(post => post.authorId)
            .onDelete(behavior)
            .hasConstraintName(`fk_${table}_users_author_id`);
    });
}
