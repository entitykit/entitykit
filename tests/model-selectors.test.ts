import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import { selectPropertyName } from '../packages/core/src/model/model-property-selector';

class User {
    public id!: string;
    public email!: string;
    public createdAt!: Date;
}

describe('model property selectors', () => {
    it('configures keys and properties with proxy-based selectors', () => {
        const builder = new ModelBuilderImplementation();

        builder.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
        });

        const user = builder.build().getEntity(User);

        expect(user.keyProperty).toBe('id');
        expect(user.getProperty('email').columnName).toBe('email');
        expect(user.getProperty('createdAt').columnName).toBe('created_at');
    });

    it('keeps string-based property configuration supported', () => {
        const builder = new ModelBuilderImplementation();

        builder.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey('id');
            entity.property('id').hasColumnName('id').hasColumnType('text').isRequired();
        });

        expect(builder.build().getEntity(User).keyProperty).toBe('id');
    });

    it('extracts a selected property name without source parsing', () => {
        const propertyName = selectPropertyName<User>(user => user.email);

        expect(propertyName).toBe('email');
    });

    it('throws when a selector does not return direct property access', () => {
        expect(() =>
            selectPropertyName<User>(() => 'email' as never),
        ).toThrow('must return a direct property access');
    });
});
