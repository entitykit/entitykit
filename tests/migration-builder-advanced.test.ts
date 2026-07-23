import type { SqlDialect } from '../src/adapter';
import { MigrationBuilder } from '../src/migrations/api';

const bracketDialect: SqlDialect = {
    name: 'bracket-sql',
    quoteIdentifier(identifier: string): string {
        return `[${identifier.replace(/]/g, ']]')}]`;
    },
    quoteQualifiedIdentifier(...identifiers: ReadonlyArray<string | undefined>): string {
        return identifiers.filter(Boolean).map(identifier => this.quoteIdentifier(String(identifier))).join('.');
    },
    parameter(): string {
        return '?';
    },
    countAllExpression(): string {
        return 'count(*)';
    },
    falsePredicate(): string {
        return '0 = 1';
    },
    insertConflictDoNothingClause(): string {
        return 'on conflict do nothing';
    },
};

describe('advanced migration builder operations', () => {
    it('supports fluent table creation', () => {
        const builder = new MigrationBuilder();

        builder.createTable('users', table => {
            table.column('id', 'uuid').primaryKey();
            table.column('email', 'text').notNull();
            table.column('deleted_at', 'timestamptz').nullable();
        }, 'app');

        expect(builder.statements[0]?.text).toBe('create table if not exists "app"."users" ("id" uuid primary key, "email" text not null, "deleted_at" timestamptz)');
    });

    it('supports rename alter and constraint helpers', () => {
        const builder = new MigrationBuilder();

        builder.renameTable('users', 'accounts', 'app');
        builder.renameColumn('accounts', 'name', 'display_name', 'app');
        builder.renameIndex('ix_users_name', 'ix_accounts_display_name', 'app');
        builder.addPrimaryKey('accounts', 'pk_accounts', ['id'], 'app');
        builder.addUniqueConstraint('accounts', 'uq_accounts_email', ['email'], 'app');
        builder.dropUniqueConstraint('accounts', 'uq_accounts_email', 'app');

        expect(builder.statements.map(statement => statement.text)).toEqual([
            'alter table "app"."users" rename to "accounts"',
            'alter table "app"."accounts" rename column "name" to "display_name"',
            'alter index "app"."ix_users_name" rename to "ix_accounts_display_name"',
            'alter table "app"."accounts" add constraint "pk_accounts" primary key ("id")',
            'alter table "app"."accounts" add constraint "uq_accounts_email" unique ("email")',
            'alter table "app"."accounts" drop constraint if exists "uq_accounts_email"',
        ]);
    });

    it('marks concurrent index operations as transaction-suppressed', () => {
        const builder = new MigrationBuilder();

        builder.createIndex({ name: 'ix_users_email', tableName: 'users', columns: ['email'], concurrently: true });
        builder.dropIndex('ix_users_email', undefined, { concurrently: true });
        builder.sql('vacuum', { suppressTransaction: true });

        expect(builder.statements.map(statement => statement.suppressTransaction)).toEqual([true, true, true]);
    });

    it('supports alter column and extension helpers', () => {
        const builder = new MigrationBuilder();

        builder.alterColumn('users', {
            name: 'display_name',
            type: 'varchar(255)',
            oldName: 'name',
            oldType: 'text',
            nullable: false,
            oldNullable: true,
            defaultSql: '\'Unknown\'',
            oldDefaultSql: undefined,
        });
        builder.createExtension('uuid-ossp');
        builder.dropExtension('uuid-ossp');

        expect(builder.statements.map(statement => statement.text)).toContain('alter table "users" rename column "name" to "display_name"');
        expect(builder.statements.map(statement => statement.text)).toContain('alter table "users" alter column "display_name" type varchar(255)');
        expect(builder.statements.map(statement => statement.text)).toContain('alter table "users" alter column "display_name" set not null');
        expect(builder.statements.map(statement => statement.text)).toContain('alter table "users" alter column "display_name" set default \'Unknown\'');
        expect(builder.statements.map(statement => statement.text)).toContain('create extension if not exists "uuid-ossp"');
        expect(builder.statements.map(statement => statement.text)).toContain('drop extension if exists "uuid-ossp"');
    });

    it('uses the configured dialect for migration DDL identifiers', () => {
        const builder = new MigrationBuilder(bracketDialect);

        builder.createSchema('app');
        builder.createTable('users', [{ name: 'id', type: 'text', primaryKey: true }], 'app');
        builder.createIndex({ name: 'ix_users_id', tableName: 'users', schemaName: 'app', columns: ['id'] });

        expect(builder.statements.map(statement => statement.text)).toEqual([
            'create schema if not exists [app]',
            'create table if not exists [app].[users] ([id] text primary key)',
            'create index if not exists [ix_users_id] on [app].[users] ([id])',
        ]);
    });

    it('rejects provider-specific helpers when custom provider capabilities are not enabled', () => {
        const builder = new MigrationBuilder(bracketDialect, {
            providerName: 'bracket-provider',
            supportsConcurrentIndexes: false,
            supportsExtensions: false,
        });

        expect(() => builder.createIndex({ name: 'ix_users_email', tableName: 'users', columns: ['email'], concurrently: true }))
            .toThrow('Migration operation \'createIndex(concurrently)\' is not supported by provider \'bracket-provider\'.');
        expect(() => builder.dropIndex('ix_users_email', undefined, { concurrently: true }))
            .toThrow('Migration operation \'dropIndex(concurrently)\' is not supported by provider \'bracket-provider\'.');
        expect(() => builder.createExtension('uuid-ossp'))
            .toThrow('Migration operation \'createExtension\' is not supported by provider \'bracket-provider\'.');
        expect(() => builder.dropExtension('uuid-ossp'))
            .toThrow('Migration operation \'dropExtension\' is not supported by provider \'bracket-provider\'.');
        expect(builder.statements).toEqual([]);
    });

    it('does not enable provider-specific helpers by dialect name alone', () => {
        const postgresNamedDialect: SqlDialect = {
            ...bracketDialect,
            name: 'postgres',
        };
        const builder = new MigrationBuilder(postgresNamedDialect);

        expect(() => builder.createExtension('uuid-ossp'))
            .toThrow('Migration operation \'createExtension\' is not supported by provider \'postgres\'.');
        expect(() => builder.createIndex({ name: 'ix_users_email', tableName: 'users', columns: ['email'], concurrently: true }))
            .toThrow('Migration operation \'createIndex(concurrently)\' is not supported by provider \'postgres\'.');
        expect(builder.statements).toEqual([]);
    });
});
