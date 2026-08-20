import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import { BaseEntityConfiguration, type EntityBuilder } from '../packages/core/src';

class User {
    public id!: string;
    public email!: string;
}

class Post {
    public id!: string;
    public title!: string;
}

class UserConfiguration extends BaseEntityConfiguration<User> {
    public readonly entity = User;

    public override configure(builder: EntityBuilder<User>): void {
        super.configure(builder);
        builder.toTable('users');
        builder.hasKey(user => user.id);
        builder.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
        builder.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
    }
}

class PostConfiguration extends BaseEntityConfiguration<Post> {
    public readonly entity = Post;

    public override configure(builder: EntityBuilder<Post>): void {
        builder.toTable('posts');
        builder.hasKey(post => post.id);
        builder.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
        builder.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
    }
}

describe('EntityTypeConfiguration', () => {
    it('applies a single configuration class', () => {
        const model = new ModelBuilderImplementation()
            .applyConfiguration(new UserConfiguration())
            .build();

        expect(model.getEntity(User).tableName).toBe('users');
        expect(model.getEntity(User).getProperty('email').columnName).toBe('email');
    });

    it('applies multiple configuration classes', () => {
        const model = new ModelBuilderImplementation()
            .applyConfigurations([new UserConfiguration(), new PostConfiguration()])
            .build();

        expect(model.entities.map(entity => entity.entityName)).toEqual(['User', 'Post']);
    });
});
