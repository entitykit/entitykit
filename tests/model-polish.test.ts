import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';class User {
    public id!: string;
    public email!: string;
    public name!: string;
    public computed!: string;
}

class Post {
    public id!: string;
}

describe('fluent model polish', () => {
    it('captures schema, ignored properties, defaults, unique properties, and indexes', () => {
        const builder = new ModelBuilderImplementation();

        builder.entity(User, entity => {
            entity.toTable('users', 'app');
            entity.hasKey(user => user.id);
            entity.ignore(user => user.computed);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('uuid').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired().isUnique();
            entity.property(user => user.name).hasColumnName('name').hasColumnType('text').hasDefaultValue('Unknown');
            entity.hasIndex(user => [user.email, user.name]).hasDatabaseName('ix_users_email_name');
        });

        const user = builder.build().getEntity(User);

        expect(user.schemaName).toBe('app');
        expect(user.tablePath).toEqual(['app', 'users']);
        expect(user.ignoredProperties).toEqual(['computed']);
        expect(user.getProperty('email').isUnique).toBe(true);
        expect(user.getProperty('name').defaultValue).toBe('Unknown');
        expect(user.indexes).toEqual([
            { propertyNames: ['email', 'name'], isUnique: false, databaseName: 'ix_users_email_name' },
            { propertyNames: ['email'], isUnique: true },
        ]);
    });

    it('fails early for duplicate columns and invalid ignored/configured properties', () => {
        const duplicateColumns = new ModelBuilderImplementation();
        duplicateColumns.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text');
            entity.property(user => user.name).hasColumnName('email').hasColumnType('text');
        });

        expect(() => duplicateColumns.build()).toThrow('maps properties \'email\' and \'name\' to the same column \'email\'');

        const ignoredThenConfigured = new ModelBuilderImplementation();
        ignoredThenConfigured.entity(User, entity => {
            entity.toTable('users');
            entity.ignore(user => user.computed);
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text');
            expect(() => entity.property(user => user.computed)).toThrow('is ignored and cannot be configured');
        });
    });

    it('rejects duplicate table mappings', () => {
        const builder = new ModelBuilderImplementation();
        builder.entity(User, entity => {
            entity.toTable('shared', 'app');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
        });
        builder.entity(Post, entity => {
            entity.toTable('shared', 'app');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
        });

        expect(() => builder.build()).toThrow('map to the same table \'app.shared\'');
    });
});
