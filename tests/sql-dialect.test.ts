import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import type { DbContextOptionsBuilder } from '../src';
import {
    DbContext,
    type ModelBuilder as ModelBuilderType,
} from '../src';
import type { SqlDialect } from '../src/adapter';
import type { EntityMetadata } from '../src/model/entity-metadata';
import { createQueryModel, createQueryProxy } from '../src/experimental';
import { ModificationSqlBuilder } from '../src/sql/modification-sql-builder';
import { SelectSqlBuilder } from '../src/sql/select-sql-builder';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class DialectUser {
    public id!: string;
    public email!: string;
    public tags: DialectTag[] = [];
}

class DialectTag {
    public id!: string;
    public label!: string;
    public users: DialectUser[] = [];
}

const testDialect: SqlDialect = {
    name: 'test-sql',
    quoteIdentifier(identifier: string): string {
        if (!identifier || identifier.trim().length === 0) {
            throw new Error('SQL identifier cannot be empty.');
        }

        return `[${identifier.replace(/]/g, ']]')}]`;
    },
    quoteQualifiedIdentifier(...identifiers: ReadonlyArray<string | undefined>): string {
        const parts = identifiers.filter((identifier): identifier is string => Boolean(identifier));
        if (parts.length === 0) {
            throw new Error('SQL identifier cannot be empty.');
        }

        return parts.map(part => this.quoteIdentifier(part)).join('.');
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

function createUserMetadata(): EntityMetadata<DialectUser> {
    const model = new ModelBuilderImplementation();
    model.entity(DialectUser, entity => {
        entity.toTable('users', 'app');
        entity.hasKey(user => user.id);
        entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
    });
    return model.build().getEntity(DialectUser);
}

describe('SQL dialect seam', () => {
    it('lets select SQL use provider-specific quoting, parameters, false predicates, and count expressions', () => {
        const metadata = createUserMetadata();
        const user = createQueryProxy<DialectUser>();
        const query = {
            ...createQueryModel(DialectUser),
            predicate: user.email.eq('a@example.com').and(user.id.in([])),
            limit: 5,
        };

        expect(new SelectSqlBuilder(testDialect).build(metadata, query)).toEqual({
            text: 'select [id], [email] from [app].[users] where ([email] = ? and 0 = 1) limit ?',
            values: ['a@example.com', 5],
        });
        expect(new SelectSqlBuilder(testDialect).buildCount(metadata, query)).toEqual({
            text: 'select count(*) as [count] from (select 1 from [app].[users] where ([email] = ? and 0 = 1) limit ?) [entitykit_page]',
            values: ['a@example.com', 5],
        });
    });

    it('lets modification SQL use provider-specific quoting and parameters', () => {
        const metadata = createUserMetadata();
        const user = new DialectUser();
        user.id = 'usr_1';
        user.email = 'a@example.com';

        expect(new ModificationSqlBuilder(testDialect).buildInsert(metadata, user)).toEqual({
            text: 'insert into [app].[users] ([id], [email]) values (?, ?)',
            values: ['usr_1', 'a@example.com'],
        });
    });

    it('threads the configured dialect through query SQL and save plans', () => {
        class DialectContext extends DbContext {
            public users = this.set(DialectUser);

            protected override configure(options: DbContextOptionsBuilder): void {
                options.useConnection(new RecordingDatabaseConnection(), {
                    provider: 'custom',
                    dialect: testDialect,
                });
            }

            protected override model(model: ModelBuilderType): void {
                model.entity(DialectUser, entity => {
                    entity.toTable('users');
                    entity.hasKey(user => user.id);
                    entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
                    entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
                });
            }
        }

        const db =  DialectContext.create();
        const user = new DialectUser();
        user.id = 'usr_1';
        user.email = 'a@example.com';
        db.users.add(user);

        expect(db.users.where(row => row.email.eq('a@example.com')).toSql()).toEqual({
            text: 'select [id], [email] from [users] where [email] = ?',
            values: ['a@example.com'],
        });
        expect(db.getSavePlan()[0]?.statement).toEqual({
            text: 'insert into [users] ([id], [email]) values (?, ?)',
            values: ['usr_1', 'a@example.com'],
        });
    });
});
