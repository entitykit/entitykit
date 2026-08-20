import { ModelBuilder as ModelBuilderImplementation } from '../../packages/core/src/model/model-builder';import type { EntityMetadata } from '../../packages/core/src/model/entity-metadata';
import type { Model } from '../../packages/core/src/model/model';
import {
    type QueryExecutor,
    type RelationExistenceMetadata,
} from '../../packages/core/src/experimental';

export class User {
    public id!: string;
    public email!: string;
    public name!: string;
    public createdAt!: Date;
    public deletedAt!: Date | null;
    public posts!: Post[];
    public roles!: Role[];
}

export class Post {
    public id!: string;
    public title!: string;
    public authorId!: string | null;
    public author!: User | null;
}

export class Role {
    public id!: string;
    public name!: string;
    public users!: User[];
}

export function createUserMetadata(): EntityMetadata<User> {
    const model = new ModelBuilderImplementation();
    model.entity(User, entity => {
        entity.toTable('users');
        entity.hasKey(user => user.id);
        entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
        entity.property(user => user.name).hasColumnName('display_name').hasColumnType('text').isRequired();
        entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
        entity.property(user => user.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
    });
    return model.build().getEntity(User);
}

export function createBlogModel(): Model {
    const model = new ModelBuilderImplementation();
    model.entity(User, entity => {
        entity.toTable('users');
        entity.hasKey(user => user.id);
        entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
        entity.property(user => user.name).hasColumnName('display_name').hasColumnType('text').isRequired();
        entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
        entity.property(user => user.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
        entity.hasManyToMany(Role, user => user.roles)
            .withMany(role => role.users)
            .usingJoinTable('user_roles', join => {
                join.sourceForeignKey('user_id');
                join.targetForeignKey('role_id');
            });
    });
    model.entity(Post, entity => {
        entity.toTable('posts');
        entity.hasKey(post => post.id);
        entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
        entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text');
        entity.hasOne(User, post => post.author).withMany(user => user.posts).hasForeignKey(post => post.authorId);
    });
    model.entity(Role, entity => {
        entity.toTable('roles');
        entity.hasKey(role => role.id);
        entity.property(role => role.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(role => role.name).hasColumnName('name').hasColumnType('text').isRequired();
    });
    return model.build();
}

export class RelationExecutor<TEntity extends object> implements QueryExecutor<TEntity> {
    constructor(
        private readonly source: EntityMetadata<TEntity>,
        private readonly model = createBlogModel(),
    ) {}

    public async executeToArray(): Promise<TEntity[]> {
        return Promise.resolve([]);
    }

    public async executeCount(): Promise<number> {
        return Promise.resolve(0);
    }

    public async executeExists(): Promise<boolean> {
        return Promise.resolve(false);
    }

    public async executeProjectionToArray<TProjection extends Record<string, unknown>>(
    ): Promise<TProjection[]> {
        return Promise.resolve([]);
    }

    public async executeAggregateToArray<TProjection extends Record<string, unknown>>(
    ): Promise<TProjection[]> {
        return Promise.resolve([]);
    }

    public resolveRelationExistence(navigationProperty: string): RelationExistenceMetadata {
        const sourceMetadata = this.source as unknown as RelationExistenceMetadata['sourceMetadata'];
        const manyToOne = sourceMetadata.relationships.find(
            relationship => relationship.navigationProperty === navigationProperty,
        );
        if (manyToOne) {
            return {
                kind: 'manyToOne',
                navigationProperty,
                sourceMetadata,
                targetMetadata: this.model.getEntity(manyToOne.principalEntity),
                relationship: manyToOne,
            };
        }

        const manyToMany = sourceMetadata.manyToManyRelationships.find(
            relationship => relationship.navigationProperty === navigationProperty,
        );
        if (manyToMany) {
            return {
                kind: 'manyToMany',
                navigationProperty,
                sourceMetadata,
                targetMetadata: this.model.getEntity(manyToMany.targetEntity),
                manyToManyRelationship: manyToMany,
            };
        }

        for (const declaringMetadata of this.model.entities) {
            const inverseManyToMany = declaringMetadata.manyToManyRelationships.find(relationship =>
                relationship.targetEntity === sourceMetadata.ctor &&
        (relationship.inverseNavigationProperty as unknown) === navigationProperty,
            );
            if (inverseManyToMany) {
                return {
                    kind: 'manyToMany',
                    navigationProperty,
                    sourceMetadata,
                    targetMetadata: declaringMetadata,
                    manyToManyRelationship: inverseManyToMany,
                };
            }
        }

        for (const dependentMetadata of this.model.entities) {
            const oneToMany = dependentMetadata.relationships.find(relationship =>
                relationship.principalEntity === sourceMetadata.ctor &&
        (relationship.inverseNavigationProperty as unknown) === navigationProperty,
            );
            if (oneToMany) {
                return {
                    kind: 'oneToMany',
                    navigationProperty,
                    sourceMetadata,
                    targetMetadata: dependentMetadata,
                    relationship: oneToMany,
                };
            }
        }

        throw new Error(`Relation '${navigationProperty}' is not configured on entity '${sourceMetadata.entityName}'.`);
    }
}
