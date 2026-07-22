import { ModelBuilder as ModelBuilderImplementation } from '../../src/model/model-builder';import type { EntityMetadata } from '../../src/model/entity-metadata';
import type { Model } from '../../src/model/model';
import {
    type QueryExecutor,
    type QueryModel,
    type RelationExistenceMetadata,
} from '../../src/experimental';

export class User {
    public id!: string;
    public email!: string;
    public createdAt!: Date;
    public posts!: Post[];
}

export class Post {
    public id!: string;
    public title!: string;
    public authorId!: string;
    public author!: User;
}

function createBlogModel(): Model {
    const model = new ModelBuilderImplementation();
    model.entity(User, entity => {
        entity.toTable('users');
        entity.hasKey(user => user.id);
        entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
        entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
    });
    model.entity(Post, entity => {
        entity.toTable('posts');
        entity.hasKey(post => post.id);
        entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
        entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
        entity.hasOne(User, post => post.author).withMany(user => user.posts).hasForeignKey(post => post.authorId);
    });
    return model.build();
}

export function createUserMetadata(): EntityMetadata<User> {
    return createBlogModel().getEntity(User);
}

export class RecordingExecutor implements QueryExecutor<User> {
    private readonly model = createBlogModel();
    public models: Array<QueryModel<User>> = [];
    public rows: User[] = [];
    public projectionRows: Array<Record<string, unknown>> = [];
    public countValue = 0;
    public existsValue = false;

    public async executeToArray(model: QueryModel<User>): Promise<User[]> {
        this.models.push(model);
        return Promise.resolve(this.rows);
    }

    public async executeCount(model: QueryModel<User>): Promise<number> {
        this.models.push(model);
        return Promise.resolve(this.countValue);
    }

    public async executeExists(model: QueryModel<User>): Promise<boolean> {
        this.models.push(model);
        return Promise.resolve(this.existsValue);
    }

    public async executeProjectionToArray<TProjection extends Record<string, unknown>>(model: QueryModel<User>): Promise<TProjection[]> {
        this.models.push(model);
        return Promise.resolve(this.projectionRows as TProjection[]);
    }

    public async executeAggregateToArray<TProjection extends Record<string, unknown>>(model: QueryModel<User>): Promise<TProjection[]> {
        this.models.push(model);
        return Promise.resolve(this.projectionRows as TProjection[]);
    }

    public resolveRelationExistence(navigationProperty: string): RelationExistenceMetadata {
        const sourceMetadata = this.model.getEntity(User) as unknown as RelationExistenceMetadata['sourceMetadata'];
        for (const dependentMetadata of this.model.entities) {
            const relationship = dependentMetadata.relationships.find(item =>
                item.principalEntity === sourceMetadata.ctor &&
        (item.inverseNavigationProperty as unknown) === navigationProperty,
            );
            if (relationship) {
                return {
                    kind: 'oneToMany',
                    navigationProperty,
                    sourceMetadata,
                    targetMetadata: dependentMetadata,
                    relationship,
                };
            }
        }

        throw new Error(`Relation '${navigationProperty}' is not configured on entity '${sourceMetadata.entityName}'.`);
    }
}
