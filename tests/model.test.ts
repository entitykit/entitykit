import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';class User {
    public id!: string;
    public email!: string;
    public name!: string;
}

class Post {
    public id!: string;
    public title!: string;
}

describe('ModelBuilder', () => {
    it('registers entity table, key, and property metadata', () => {
        const builder = new ModelBuilderImplementation();

        builder.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey('id');
            entity.property('id').hasColumnName('id').hasColumnType('text').isRequired();
            entity.property('email').hasColumnName('email_address').hasColumnType('text').isRequired();
            entity.property('name').hasColumnName('name').hasColumnType('text').isOptional();
        });

        const model = builder.build();
        const user = model.getEntity(User);

        expect(user.ctor).toBe(User);
        expect(user.entityName).toBe('User');
        expect(user.tableName).toBe('users');
        expect(user.keyProperty).toBe('id');
        expect(user.properties).toHaveLength(3);
        expect(user.getProperty('email')).toMatchObject({
            propertyName: 'email',
            columnName: 'email_address',
            columnType: 'text',
            isRequired: true,
            isPrimaryKey: false,
        });
        expect(user.getProperty('id')).toMatchObject({
            isRequired: true,
            isPrimaryKey: true,
        });
    });

    it('supports registering multiple entity types', () => {
        const builder = new ModelBuilderImplementation();

        builder.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey('id');
            entity.property('id').hasColumnName('id').hasColumnType('text').isRequired();
        });

        builder.entity(Post, entity => {
            entity.toTable('posts');
            entity.hasKey('id');
            entity.property('id').hasColumnName('id').hasColumnType('text').isRequired();
            entity.property('title').hasColumnName('title').hasColumnType('text').isRequired();
        });

        const model = builder.build();

        expect(model.entities.map(entity => entity.tableName)).toEqual(['users', 'posts']);
        expect(model.getEntity(Post).getProperty('title').columnName).toBe('title');
    });

    it('throws when an entity is missing a table', () => {
        const builder = new ModelBuilderImplementation();

        builder.entity(User, entity => {
            entity.hasKey('id');
            entity.property('id').hasColumnName('id').hasColumnType('text').isRequired();
        });

        expect(() => builder.build()).toThrow('must configure a table name');
    });

    it('throws when an entity is missing a key', () => {
        const builder = new ModelBuilderImplementation();

        builder.entity(User, entity => {
            entity.toTable('users');
            entity.property('id').hasColumnName('id').hasColumnType('text').isRequired();
        });

        expect(() => builder.build()).toThrow('must configure a primary key');
    });

    it('throws when a property is missing a column type', () => {
        const builder = new ModelBuilderImplementation();

        builder.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey('id');
            entity.property('id').hasColumnName('id').isRequired();
        });

        expect(() => builder.build()).toThrow('must configure a column type');
    });
});
