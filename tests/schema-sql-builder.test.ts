import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import type { SqlDialect } from '../src/adapter';
import { SchemaSqlBuilder } from '../src/schema/schema-sql-builder';

class User {
    public id!: string;
    public email!: string;
    public name?: string;
}

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

describe('SchemaSqlBuilder', () => {
    it('generates create table SQL from model metadata', () => {
        const modelBuilder = new ModelBuilderImplementation();
        modelBuilder.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(user => user.name).hasColumnName('name').hasColumnType('text').isOptional();
        });

        expect(new SchemaSqlBuilder().build(modelBuilder.build())).toBe([
            'create table if not exists "users" (',
            '  "id" text primary key,',
            '  "email" text not null,',
            '  "name" text',
            ');',
        ].join('\n'));
    });

    it('uses the configured dialect for schema DDL identifiers', () => {
        const modelBuilder = new ModelBuilderImplementation();
        modelBuilder.entity(User, entity => {
            entity.toTable('users', 'app');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
        });

        expect(new SchemaSqlBuilder(bracketDialect).build(modelBuilder.build())).toContain(
            'create table if not exists [app].[users] (\n  [id] text primary key,\n  [email] text not null\n);',
        );
        expect(new SchemaSqlBuilder(bracketDialect).build(modelBuilder.build())).toContain('create schema if not exists [app];');
    });
});
