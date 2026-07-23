import type { SqlDialect } from '../src/adapter';
import {
    Migration,
    MigrationBuilder,
    MigrationSqlGenerator,
    selectMigrationRange,
    type MigrationSqlDialect,
} from '../src/migrations/api';

class CreateUsers extends Migration {
    public readonly id = '20260601120000_CreateUsers';
    public readonly name = 'CreateUsers';
    public override up(builder: MigrationBuilder): void {
        builder.createTable('users', [{ name: 'id', type: 'uuid', primaryKey: true }]);
    }
    public override down(builder: MigrationBuilder): void {
        builder.dropTable('users');
    }
}

class AddPosts extends Migration {
    public readonly id = '20260601130000_AddPosts';
    public readonly name = 'AddPosts';
    public override up(builder: MigrationBuilder): void {
        builder.createTable('posts', [{ name: 'id', type: 'uuid', primaryKey: true }]);
    }
    public override down(builder: MigrationBuilder): void {
        builder.dropTable('posts');
    }
}

class ConcurrentIndex extends Migration {
    public readonly id = '20260601140000_ConcurrentIndex';
    public readonly name = 'ConcurrentIndex';
    public override up(builder: MigrationBuilder): void {
        builder.createIndex({ name: 'ix_users_email', tableName: 'users', columns: ['email'], concurrently: true });
    }
}

class BackfillDisplayNames extends Migration {
    public readonly id = '20260601150000_BackfillDisplayNames';
    public readonly name = 'BackfillDisplayNames';
    public override up(builder: MigrationBuilder): void {
        builder.addColumn('users', { name: 'display_name', type: 'text', nullable: true });
        builder.sql('update "users" set "display_name" = coalesce("name", $1) where "display_name" is null', ['Anonymous']);
        builder.alterColumn('users', {
            name: 'display_name',
            type: 'text',
            oldType: 'text',
            nullable: false,
            oldNullable: true,
        });
        builder.createIndex({ name: 'ix_users_display_name', tableName: 'users', columns: ['display_name'], concurrently: true });
    }
    public override down(builder: MigrationBuilder): void {
        builder.dropIndex('ix_users_display_name', undefined, { concurrently: true });
        builder.sql('update "users" set "name" = "display_name" where "name" is null');
        builder.dropColumn('users', 'display_name');
    }
}

const bracketSqlDialect: SqlDialect = {
    name: 'bracket-sql',
    quoteIdentifier(identifier: string): string {
        return `[${identifier.replace(/]/g, ']]')}]`;
    },
    quoteQualifiedIdentifier(...identifiers: ReadonlyArray<string | undefined>): string {
        return identifiers.filter((identifier): identifier is string => Boolean(identifier)).map(identifier => this.quoteIdentifier(identifier)).join('.');
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

function createCustomMigrationDialect(options: {
    readonly renderIdempotentMigrationBlock?: MigrationSqlDialect['renderIdempotentMigrationBlock'];
} = {}): MigrationSqlDialect {
    return {
        name: 'custom-migrations',
        sql: bracketSqlDialect,
        createMigrationHistoryTableStatement: () => ({
            text: 'create table if not exists [migrations] ([id] text primary key, [name] text not null, [checksum] text not null, [entitykit_version] text not null)',
            values: [],
        }),
        selectMigrationHistoryStatement: () => ({
            text: 'select [id], [name], [checksum], [entitykit_version] from [migrations] order by [id]',
            values: [],
        }),
        insertMigrationHistoryStatement: (migration, checksum) => ({
            text: 'insert into [migrations] ([id], [name], [checksum], [entitykit_version]) values (?, ?, ?, ?)',
            values: [migration.id, migration.name, checksum, 'test'],
        }),
        deleteMigrationHistoryStatement: migration => ({
            text: 'delete from [migrations] where [id] = ?',
            values: [migration.id],
        }),
        renderIdempotentMigrationBlock: options.renderIdempotentMigrationBlock,
    };
}

describe('migration script generation', () => {
    it('generates full forward scripts', () => {
        const script = new MigrationSqlGenerator().generateScript([new CreateUsers(), new AddPosts()]);

        expect(script).toContain('create table if not exists "users"');
        expect(script).toContain('create table if not exists "posts"');
        expect(script).toContain('insert into "__entitykit_migrations"');
    });

    it('selects forward and rollback migration ranges', () => {
        expect(selectMigrationRange([new CreateUsers(), new AddPosts()], 'CreateUsers', 'Latest').map(item => item.migration.name)).toEqual(['AddPosts']);
        expect(selectMigrationRange([new CreateUsers(), new AddPosts()], 'Latest', 'CreateUsers').map(item => `${item.direction}:${item.migration.name}`)).toEqual(['down:AddPosts']);
    });

    it('generates idempotent scripts guarded by migration history', () => {
        const script = new MigrationSqlGenerator().generateScript([new CreateUsers()], { idempotent: true });

        expect(script).toContain('if not exists (select 1 from "__entitykit_migrations" where "id" = \'20260601120000_CreateUsers\') then');
        expect(script).toContain('create table if not exists "users"');
    });

    it('rejects idempotent scripts when the migration dialect does not provide a renderer', () => {
        expect(() => new MigrationSqlGenerator(createCustomMigrationDialect()).generateScript([new CreateUsers()], { idempotent: true }))
            .toThrow('Idempotent scripts are not supported by migration dialect \'custom-migrations\'.');
    });

    it('uses the migration dialect renderer for custom idempotent scripts', () => {
        const script = new MigrationSqlGenerator(createCustomMigrationDialect({
            renderIdempotentMigrationBlock: (migration, bodySql) => [
                `-- custom idempotent block for ${migration.id}`,
                bodySql,
            ].join('\n'),
        })).generateScript([new CreateUsers()], { idempotent: true });

        expect(script).toContain('-- custom idempotent block for 20260601120000_CreateUsers');
        expect(script).toContain('create table if not exists [users] ([id] uuid primary key);');
        expect(script).not.toContain('do $entitykit$');
    });

    it('rejects idempotent scripts containing transaction-suppressed statements', () => {
        expect(() => new MigrationSqlGenerator().generateScript([new ConcurrentIndex()], { idempotent: true }))
            .toThrow('Idempotent scripts cannot include transaction-suppressed statements');
    });

    it('renders mixed helper DDL, manual data SQL, and rollback SQL for hand-authored migrations', () => {
        const generator = new MigrationSqlGenerator();
        const up = generator.generateUpScript(new BackfillDisplayNames());
        const down = generator.generateDownScript(new BackfillDisplayNames());

        expect(up).toContain('alter table "users" add column "display_name" text;');
        expect(up).toContain('update "users" set "display_name" = coalesce("name", \'Anonymous\') where "display_name" is null;');
        expect(up).toContain('alter table "users" alter column "display_name" set not null;');
        expect(up).toContain('-- EntityKit: runs outside the migration transaction by request.');
        expect(up).toContain('create index concurrently if not exists "ix_users_display_name" on "users" ("display_name");');
        expect(up.indexOf('alter table "users" add column "display_name" text;')).toBeLessThan(up.indexOf('update "users" set "display_name"'));
        expect(up.indexOf('update "users" set "display_name"')).toBeLessThan(up.indexOf('alter table "users" alter column "display_name" set not null;'));

        expect(down).toContain('-- EntityKit: runs outside the migration transaction by request.');
        expect(down).toContain('drop index concurrently if exists "ix_users_display_name";');
        expect(down).toContain('update "users" set "name" = "display_name" where "name" is null;');
        expect(down).toContain('alter table "users" drop column "display_name";');
    });

    it('uses the configured migration builder factory for generated DDL', () => {
        let builderCreations = 0;
        const generator = new MigrationSqlGenerator(undefined, () => {
            builderCreations += 1;
            return new MigrationBuilder();
        });

        const script = generator.generateUpScript(new CreateUsers());

        expect(builderCreations).toBe(2);
        expect(script).toContain('create table if not exists "users"');
    });
});
