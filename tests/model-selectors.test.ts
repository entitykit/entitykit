import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import {
    isModelPropertyToken,
    selectPropertyName,
    selectPropertyNames,
} from '../packages/core/src/model/model-property-selector';

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

    it('selects ordered property lists and rejects empty or invalid lists', () => {
        expect(selectPropertyNames<User>(user => [user.email, user.id])).toEqual(['email', 'id']);
        expect(() => selectPropertyNames<User>(() => [])).toThrow('must return at least one property');
        expect(() => selectPropertyNames<User>(user => [user.id, 'email' as never]))
            .toThrow('Model property list selectors must return property accesses');
    });

    it.each([null, undefined, false, 0, 1, 'id', Symbol('id')])('rejects non-object tokens: %s', value => {
        expect(isModelPropertyToken(value)).toBe(false);
    });

    it('rejects a function carrying copied token properties', () => {
        const forged = (): number => 1;
        selectPropertyName<User>(user => {
            Object.assign(forged, user.id);
            return user.id;
        });
        expect(isModelPropertyToken(forged)).toBe(false);
    });
});
