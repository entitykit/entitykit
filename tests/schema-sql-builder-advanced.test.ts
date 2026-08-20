import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';import { SchemaSqlBuilder } from '../packages/core/src/schema/schema-sql-builder';

class User {
    public id!: string;
    public email!: string;
    public name!: string;
    public createdAt!: Date;
    public metadata!: Record<string, unknown>;
}

describe('SchemaSqlBuilder advanced metadata', () => {
    it('generates schemas, defaults, max lengths, unique indexes, and composite indexes', () => {
        const modelBuilder = new ModelBuilderImplementation();
        modelBuilder.entity(User, entity => {
            entity.toTable('users', 'app');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('uuid').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').hasMaxLength(255).isRequired().isUnique();
            entity.property(user => user.name).hasColumnName('name').hasColumnType('text').hasDefaultValue('Unknown').isRequired();
            entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').hasDefaultSql('now()').isRequired();
            entity.property(user => user.metadata).hasColumnName('metadata').hasColumnType('jsonb').hasDefaultValue({ source: 'test' }).isOptional();
            entity.hasIndex(user => [user.email, user.name]).hasDatabaseName('ix_users_email_name');
        });

        expect(new SchemaSqlBuilder().build(modelBuilder.build())).toBe([
            'create schema if not exists "app";',
            '',
            'create table if not exists "app"."users" (',
            '  "id" uuid primary key,',
            '  "email" varchar(255) not null,',
            '  "name" text not null default \'Unknown\',',
            '  "created_at" timestamptz not null default now(),',
            '  "metadata" jsonb default \'{"source":"test"}\'',
            ');',
            '',
            'create index if not exists "ix_users_email_name" on "app"."users" ("email", "name");',
            '',
            'create unique index if not exists "ux_users_email" on "app"."users" ("email");',
        ].join('\n'));
    });
});
