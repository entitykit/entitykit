import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';

class User {
    public id!: string;
    public email!: string;
    public displayName?: string;
    public createdAt!: Date;
    public updatedAt!: Date;
}

describe('canonical fluent API', () => {
    it('maps EF-inspired entity and property configuration to metadata', () => {
        const model = new ModelBuilderImplementation();

        model.entity(User, builder => {
            builder.toTable('users').hasSchema('app');
            builder.hasKey(user => user.id);

            builder.property(user => user.id)
                .hasColumnName('id')
                .hasColumnType('uuid')
                .isRequired();

            builder.property(user => user.email)
                .hasColumnName('email')
                .hasColumnType('varchar')
                .hasMaxLength(255)
                .isRequired()
                .isUnique();

            builder.property(user => user.displayName)
                .hasColumnName('display_name')
                .hasColumnType('text')
                .hasDefaultValue('Unknown')
                .isOptional();

            builder.property(user => user.createdAt)
                .hasColumnName('created_at')
                .hasColumnType('timestamptz')
                .hasDefaultSql('now()')
                .isRequired();

            builder.property(user => user.updatedAt)
                .hasColumnName('updated_at')
                .hasColumnType('timestamptz')
                .hasDefaultSql('now()')
                .isRequired();

            builder.hasIndex(user => [user.email, user.displayName])
                .hasDatabaseName('ix_users_email_display_name')
                .isUnique();
        });

        const user = model.build().getEntity(User);

        expect(user.schemaName).toBe('app');
        expect(user.keyProperty).toBe('id');
        expect(user.getProperty('email')).toMatchObject({
            columnName: 'email',
            columnType: 'varchar',
            maxLength: 255,
            isRequired: true,
            isUnique: true,
        });
        expect(user.getProperty('displayName')).toMatchObject({
            defaultValue: 'Unknown',
            isRequired: false,
        });
        expect(user.getProperty('createdAt').defaultSql).toBe('now()');
        expect(user.indexes[0]).toEqual({
            propertyNames: ['email', 'displayName'],
            isUnique: true,
            databaseName: 'ix_users_email_display_name',
        });
    });
});
