import { ModelValidationError } from '../../packages/core/src';
import { contextMigrations, diffModelSnapshots } from '../../packages/core/src/migrations/api';
import { createSqliteDataSource } from '../../packages/sqlite/src';
import { RelationshipIndexContext } from './one-to-one-index-support';
import { scaffoldedMigration } from './migration-table-order-support';
import { caseCollidingSnapshot } from './index-identity-support';

export function defineSqliteCaseIndexMigrationTests(): void {
    for (const expressionFirst of [false, true]) {
        for (const transition of ['addition', 'removal'] as const) {
            for (const form of ['runtime', 'generated'] as const) {
                it.each(['apply', 'revert', 'update', 'rollback'] as const)(
                    `refuses %s of ${form} ${transition}, expression first = ${String(expressionFirst)}, preserving stored enforcement`, async operation => {
                        const source = createSqliteDataSource(':memory:');
                        try {
                            await using db = source.createContext(RelationshipIndexContext, 'original');
                            const api = contextMigrations(db);
                            const original = api.createModelSnapshot();
                            const invalid = caseCollidingSnapshot(original, expressionFirst);
                            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, original).toMigration('20261004010000_Initial', 'Initial');
                            await api.update([initial]);
                            const query = async (text: string): ReturnType<typeof db.database.connection.query> => db.database.connection.query({ text, values: [] });
                            await query('insert into ek_index_users (id) values (\'user-1\'), (\'user-2\')');
                            await query('insert into ek_index_profiles (id, user_id, label) values (\'first\', \'user-1\', \'first\')');
                            const from = transition === 'addition' ? original : invalid;
                            const to = transition === 'addition' ? invalid : original;
                            const migration = form === 'runtime' ? diffModelSnapshots(from, to).toMigration('20261004010001_CaseIndex', 'CaseIndex')
                                : scaffoldedMigration(from, to).migration;
                            const indexes = await query('select name, sql from sqlite_master where type = \'index\' order by name');
                            const history = await query('select id, checksum from __entitykit_migrations order by id');
                            const attempt = operation === 'apply' ? api.apply(migration)
                                : operation === 'revert' ? api.revert(migration)
                                    : api.update([initial, migration], { allowDataLoss: true, target: operation === 'rollback' ? initial.id : undefined });
                            await expect(attempt).rejects.toThrow(ModelValidationError);
                            expect(await query('select name, sql from sqlite_master where type = \'index\' order by name')).toEqual(indexes);
                            expect(await query('select id, checksum from __entitykit_migrations order by id')).toEqual(history);
                            await expect(query('insert into ek_index_profiles (id, user_id, label) values (\'duplicate\', \'user-1\', \'second\')')).rejects.toThrow();
                            expect((await query('select id, label from ek_index_profiles order by id')).rows).toEqual([{ id: 'first', label: 'first' }]);
                            await query('insert into ek_index_profiles (id, user_id, label) values (\'different-user\', \'user-2\', \'second\')');
                        } finally {
                            await source.dispose(); 
                        }
                    },
                );
            }
        }
    }
}
