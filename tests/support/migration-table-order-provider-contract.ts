import type { DatabaseConnection, DatabaseProviderServices } from '../../packages/core/src/adapter';
import { PostgresDatabaseConnection, postgresProviderServices } from '../../packages/postgres/src';
import { MySqlDatabaseConnection, mySqlProviderServices } from '../../packages/mysql/src';
import { SqliteDatabaseConnection, sqliteProviderServices } from '../../packages/sqlite/src';
import { emptySnapshot } from '../model-differ-support';
import { emailClaimSnapshot, scaffoldedMigration } from './migration-table-order-support';

type Provider = 'sqlite' | 'postgres' | 'mysql';

export function defineMigrationTableOrderProviderTests(provider: Provider, url: () => string): void {
    const services: DatabaseProviderServices = provider === 'sqlite' ? sqliteProviderServices
        : provider === 'postgres' ? postgresProviderServices : mySqlProviderServices;
    const cases = [
        { name: 'email claims', options: {} },
        { name: 'three-table chain', options: { chain: true } },
        { name: 'self reference', options: { selfReference: true } },
        { name: 'cyclic schema', options: { cyclic: true } },
    ];
    it.each(cases)('executes generated $name with enforced foreign keys and reverse migration', async ({ options }) => {
        const connection: DatabaseConnection = provider === 'sqlite' ? new SqliteDatabaseConnection(url())
            : provider === 'postgres' ? new PostgresDatabaseConnection(url()) : new MySqlDatabaseConnection(url());
        const target = emailClaimSnapshot(options);
        const migration = scaffoldedMigration(emptySnapshot, target).migration;
        const removed = scaffoldedMigration(target, emptySnapshot).migration;
        const query = async (text: string): Promise<void> => {
            await connection.query({ text, values: [] });
        };
        const execute = async (direction: 'up' | 'down', source = migration): Promise<void> => {
            const builder = services.createMigrationBuilder();
            source[direction](builder);
            for (const statement of builder.statements) await connection.query(statement);
        };
        const clear = async (): Promise<void> => {
            if (options.cyclic || options.selfReference) {
                await query('update ek_order_users set reference_id = null');
            }
            await query('delete from ek_order_email_claims');
            await query('delete from ek_order_users');
        };
        try {
            await execute('up');
            await query('insert into ek_order_users (id, email) values (1, \'buyer@example.test\')');
            await query('insert into ek_order_email_claims (id, user_id) values (2, 1)');
            if (options.chain) await query('insert into ek_order_email_tokens (id, claim_id) values (3, 2)');
            if (options.selfReference) await query('update ek_order_users set reference_id = 1 where id = 1');
            if (options.cyclic) await query('update ek_order_users set reference_id = 2 where id = 1');
            await expect(query('insert into ek_order_email_claims (id, user_id) values (99, 999)')).rejects.toThrow();
            await expect(query('delete from ek_order_users where id = 1')).rejects.toThrow();
            expect((await connection.query({ text: 'select id from ek_order_email_claims', values: [] })).rows).toEqual([{ id: 2 }]);
            // SQLite restrict cycles require explicit data cleanup before DDL.
            // Ordinary dependency chains remain populated during rollback.
            if (options.cyclic && provider === 'sqlite') await clear();
            await execute('down');
            await expect(query('select id from ek_order_users')).rejects.toThrow();
            await execute('down', removed);
            await query('insert into ek_order_users (id, email) values (1, \'restored@example.test\')');
            await query('insert into ek_order_email_claims (id, user_id) values (2, 1)');
            await expect(query('insert into ek_order_email_claims (id, user_id) values (99, 999)')).rejects.toThrow();
            await execute('up', removed);
            await expect(query('select id from ek_order_email_claims')).rejects.toThrow();
        } finally {
            try {
                // Owned fixture tables only. If a failed assertion left data,
                // clear references before removing the tables for the next case.
                await query('drop table if exists ek_order_email_tokens');
                await clear().catch(() => undefined);
                await query('drop table if exists ek_order_email_claims');
                await query('drop table if exists ek_order_users');
            } finally {
                await connection.dispose?.();
            }
        }
    });
}
