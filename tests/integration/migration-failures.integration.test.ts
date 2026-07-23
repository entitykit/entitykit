import { requireDefined } from '../support/require-defined';
import type { DatabaseConnection } from '../../src';
import type { MigrationBuilder } from '../../src/migrations/api';
import { Migration, MigrationRunner } from '../../src/migrations/api';
import { postgresProviderServices } from '../../src/providers/postgres';
import type { PostgresDatabaseConnection } from '../../src/providers/postgres/pg-database-connection';

const shouldRun = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const maybe = shouldRun ? describe : describe.skip;

class CreateFirst extends Migration {
    public readonly id = '20260101000001_CreateFirst';
    public readonly name = 'CreateFirst';
    public override up(b: MigrationBuilder): void {
        b.createTable('mig_first', [{ name: 'id', type: 'text', primaryKey: true }]);
    }
    public override down(b: MigrationBuilder): void {
        b.dropTable('mig_first');
    }
}

/** Its second statement is invalid, so it fails after doing real work. */
class FailsHalfway extends Migration {
    public readonly id = '20260101000002_FailsHalfway';
    public readonly name = 'FailsHalfway';
    public override up(b: MigrationBuilder): void {
        b.createTable('mig_second', [{ name: 'id', type: 'text', primaryKey: true }]);
        b.sql('insert into mig_second (id) values (\'x\'), (\'x\')');   // duplicate key
    }
    public override down(b: MigrationBuilder): void {
        b.dropTable('mig_second');
    }
}

/** Runs a statement outside the transaction, then fails inside one. */
class FailsAfterSuppressed extends Migration {
    public readonly id = '20260101000003_FailsAfterSuppressed';
    public readonly name = 'FailsAfterSuppressed';
    public override up(b: MigrationBuilder): void {
        b.createTable('mig_third', [{ name: 'id', type: 'text', primaryKey: true }]);
        b.sql('create index concurrently mig_third_ix on mig_third (id)', { suppressTransaction: true });
        b.sql('select 1 / 0');
    }
    public override down(b: MigrationBuilder): void {
        b.dropTable('mig_third');
    }
}

class CreateThird extends Migration {
    public readonly id = '20260101000004_CreateFourth';
    public readonly name = 'CreateFourth';
    public override up(b: MigrationBuilder): void {
        b.createTable('mig_fourth', [{ name: 'id', type: 'text', primaryKey: true }]);
    }
    public override down(b: MigrationBuilder): void {
        b.dropTable('mig_fourth');
    }
}

maybe('migration failure paths', () => {
    let connection: PostgresDatabaseConnection;

    const fresh = async (): Promise<PostgresDatabaseConnection> => {
        const { PostgresDatabaseConnection } = await import('../../src/providers/postgres/pg-database-connection');
        const created = new PostgresDatabaseConnection(requireDefined(process.env.DATABASE_URL));
        for (const table of ['mig_first', 'mig_second', 'mig_third', 'mig_fourth', '__entitykit_migrations']) {
            await created.query({ text: `drop table if exists ${table}`, values: [] });
        }
        return created;
    };

    const runner = (target: DatabaseConnection): MigrationRunner => new MigrationRunner(
        target,
        postgresProviderServices.migrationDialect,
        postgresProviderServices.createMigrationBuilder,
    );

    const appliedIds = async (target: DatabaseConnection = connection): Promise<string[]> => {
        const result = await target.query<{ id: string }>({
            text: 'select id from __entitykit_migrations order by id',
            values: [],
        });
        return result.rows.map(row => row.id.replace(/^\d+_/, ''));
    };

    const tables = async (target: DatabaseConnection = connection): Promise<string[]> => {
        const result = await target.query<{ table_name: string }>({
            text: 'select table_name from information_schema.tables where table_schema = \'public\' and table_name like \'mig_%\' order by table_name',
            values: [],
        });
        return result.rows.map(row => row.table_name);
    };

    beforeEach(async () => {
        connection = await fresh();
    });

    afterEach(async () => {
        await connection.dispose();
    });

    it('leaves history agreeing with the schema when a migration fails partway', async () => {
    // The worst outcome available to a migration tool is a history that
    // disagrees with the database. The failing migration's table must not
    // survive, and the one after it must not be attempted.
        await expect(runner(connection).update([new CreateFirst(), new FailsHalfway(), new CreateThird()]))
            .rejects.toThrow(/FailsHalfway/);

        expect(await appliedIds()).toEqual(['CreateFirst']);
        expect(await tables()).toEqual(['mig_first']);
    });

    it('says so when a transaction-suppressed statement may have left partial work', async () => {
    // `create index concurrently` cannot run inside a transaction, so a
    // migration containing one is split across transactions and Postgres itself
    // cannot roll the whole thing back. EntityKit cannot make this atomic; what
    // it can do is refuse to be vague about it.
        await expect(runner(connection).update([new CreateFirst(), new FailsAfterSuppressed()]))
            .rejects.toThrow(/mixed transactional and transaction-suppressed statements/);

        await expect(runner(connection).update([new CreateFirst(), new FailsAfterSuppressed()]))
            .rejects.toThrow(/inspect the database for partial transaction-suppressed work/);

        // History records only what completed; the partial objects really are there.
        expect(await appliedIds()).toEqual(['CreateFirst']);
        expect(await tables()).toContain('mig_third');
    });

    it('refuses to continue when an applied migration\'s checksum changed', async () => {
        await runner(connection).update([new CreateFirst()]);
        await connection.query({ text: 'update __entitykit_migrations set checksum = \'tampered\'', values: [] });

        await expect(runner(connection).update([new CreateFirst(), new CreateThird()]))
            .rejects.toThrow(/checksum does not match the local migration file/);

        // Nothing was applied on the way to noticing.
        expect(await appliedIds()).toEqual(['CreateFirst']);
        expect(await tables()).toEqual(['mig_first']);
    });

    it('applies each migration exactly once when two runners race', async () => {
        const { PostgresDatabaseConnection } = await import('../../src/providers/postgres/pg-database-connection');
        const second = new PostgresDatabaseConnection(requireDefined(process.env.DATABASE_URL));

        const results = await Promise.allSettled([
            runner(connection).update([new CreateFirst(), new CreateThird()]),
            runner(second).update([new CreateFirst(), new CreateThird()]),
        ]);

        // The advisory lock serializes them: one does the work, the other finds
        // nothing left to do. Neither fails, and neither applies twice.
        expect(results.every(result => result.status === 'fulfilled')).toBe(true);
        const applied = results.map(result => result.status === 'fulfilled' ? result.value.appliedMigrations.length : -1);
        expect(applied.reduce((total, count) => total + count, 0)).toBe(2);

        expect(await appliedIds()).toEqual(['CreateFirst', 'CreateFourth']);
        await second.dispose();
    });

    it('rolls back to zero cleanly', async () => {
        await runner(connection).update([new CreateFirst(), new CreateThird()]);

        await runner(connection).update([new CreateFirst(), new CreateThird()], { target: '0' });

        expect(await appliedIds()).toEqual([]);
        expect(await tables()).toEqual([]);
    });
});
