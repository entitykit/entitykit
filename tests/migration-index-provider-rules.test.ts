import { ModelValidationError } from '../packages/core/src';
import { diffModelSnapshots, MigrationRunner, MigrationSqlGenerator, migrationChecksum } from '../packages/core/src/migrations/api';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { mySqlProviderServices } from '../packages/mysql/src';
import { postgresProviderServices } from '../packages/postgres/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import { scaffoldedMigration } from './support/migration-table-order-support';
import { caseCollidingSnapshot, indexIdentitySnapshot } from './support/index-identity-support';
import type { ModelSnapshot } from '../packages/core/src/model/model-snapshot-types';

const transitions = [{ name: 'addition', removal: false }, { name: 'removal', removal: true }];
function snapshots(removal: boolean): { readonly from: ModelSnapshot; readonly to: ModelSnapshot } {
    const original = indexIdentitySnapshot();
    const invalid = caseCollidingSnapshot(original);
    return removal ? { from: invalid, to: original } : { from: original, to: invalid };
}
describe.each([sqliteProviderServices, mySqlProviderServices])('$name migration physical index validation', provider => {
    describe.each(transitions)('$name', transition => {
        it.each(['runtime', 'generated'] as const)('refuses %s SQL and checksums in both directions', form => {
            const { from, to } = snapshots(transition.removal);
            const migration = form === 'runtime' ? diffModelSnapshots(from, to).toMigration('index-test', 'IndexTest')
                : scaffoldedMigration(from, to).migration;
            const generator = new MigrationSqlGenerator(provider.migrationDialect, provider.createMigrationBuilder);
            expect(() => generator.generateUpScript(migration)).toThrow(ModelValidationError);
            expect(() => generator.generateDownScript(migration)).toThrow(ModelValidationError);
            expect(() => generator.generateScript([migration])).toThrow(ModelValidationError);
            expect(() => migrationChecksum(migration, provider.dialect, provider.createMigrationBuilder)).toThrow(ModelValidationError);
        });
        it.each(['apply', 'revert', 'update'] as const)('refuses %s before locks, history, sessions or writes', async operation => {
            const connection = new RecordingDatabaseConnection();
            const runner = new MigrationRunner(connection, provider.migrationDialect, provider.createMigrationBuilder);
            const { from, to } = snapshots(transition.removal);
            const migration = diffModelSnapshots(from, to).toMigration('index-test', 'IndexTest');
            await expect(operation === 'update' ? runner.update([migration], { target: '0', allowDataLoss: true })
                : runner[operation](migration)).rejects.toThrow(ModelValidationError);
            expect(connection.statements).toEqual([]);
            expect(connection.sessionEvents).toEqual([]);
            expect(connection.transactionEvents).toEqual([]);
        });
    });
});

describe.each(transitions)('Postgres quoted index names during $name', transition => {
    it.each(['runtime', 'generated'] as const)('preserves both %s snapshot identities and SQL directions', form => {
        const { from, to } = snapshots(transition.removal);
        const migration = form === 'runtime' ? diffModelSnapshots(from, to).toMigration('index-test', 'IndexTest')
            : scaffoldedMigration(from, to).migration;
        expect(migration.previousSnapshot).toEqual(from);
        expect(migration.targetSnapshot).toEqual(to);
        const provider = postgresProviderServices;
        const generator = new MigrationSqlGenerator(provider.migrationDialect, provider.createMigrationBuilder);
        expect(generator.generateUpScript(migration)).toContain('"UX_INDEXED_RECORDS_USER_ID"');
        expect(generator.generateDownScript(migration)).toContain('"UX_INDEXED_RECORDS_USER_ID"');
        expect(migrationChecksum(migration, provider.dialect, provider.createMigrationBuilder)).toMatch(/^[a-f0-9]{64}$/);
    });
});

it('keeps snapshot-free handwritten migrations valid', () => {
    const migration = { id: 'raw', name: 'Raw', up: (): void => undefined, down: (): void => undefined };
    expect(() => new MigrationSqlGenerator(sqliteProviderServices.migrationDialect).generateUpScript(migration)).not.toThrow();
});
