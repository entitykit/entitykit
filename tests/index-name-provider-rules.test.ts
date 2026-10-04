import { ModelValidationError } from '../packages/core/src';
import { SchemaSqlBuilder } from '../packages/core/src/schema/schema-sql-builder';
import { bootstrapDbContext } from '../packages/core/src/core/db-context-initializer';
import { sqliteProviderServices, SqliteDatabaseConnection } from '../packages/sqlite/src';
import { mySqlProviderServices } from '../packages/mysql/src';
import { postgresProviderServices } from '../packages/postgres/src';
import { indexIdentityModel } from './support/index-identity-support';

const services = [sqliteProviderServices, mySqlProviderServices, postgresProviderServices];
describe.each(services)('$name physical index identity', provider => {
    it.each([false, true])('handles case-only names with equivalent definitions = %s', equivalent => {
        const model = indexIdentityModel(['ux_same', 'UX_SAME'], equivalent);
        const build = (): string => new SchemaSqlBuilder(provider.dialect).build(model);
        if (provider.name === 'postgres') {
            expect(build()).toContain('"ux_same"');
            expect(build()).toContain('"UX_SAME"');
        } else expect(build).toThrow(ModelValidationError);
    });
    it('preserves distinct identifiers and equivalent declarations with identical spelling', () => {
        expect(() => new SchemaSqlBuilder(provider.dialect).build(indexIdentityModel(['ux_first', 'ux_second']))).not.toThrow();
        expect(() => new SchemaSqlBuilder(provider.dialect).build(indexIdentityModel(['ux_same', 'ux_same'], true))).not.toThrow();
    });
});

it('does not apply Unicode case folding to SQLite identifiers', async () => {
    const sql = new SchemaSqlBuilder(sqliteProviderServices.dialect).build(indexIdentityModel(['ix_Å', 'ix_å']));
    expect(sql).toContain('"ix_Å"');
    expect(sql).toContain('"ix_å"');
    const connection = new SqliteDatabaseConnection(':memory:');
    try {
        for (const text of new SchemaSqlBuilder(sqliteProviderServices.dialect).buildStatements(indexIdentityModel(['ix_Å', 'ix_å']))) {
            await connection.query({ text, values: [] });
        }
        expect((await connection.query({ text: 'select name from sqlite_master where type = \'index\' and name like \'ix_%\' order by name', values: [] })).rows)
            .toEqual([{ name: 'ix_Å' }, { name: 'ix_å' }]);
    } finally {
        await connection.dispose();
    }
});

it('rejects a case-equivalent context model before leasing a connection', () => {
    const createConnection = jest.fn();
    const source = { providerName: 'sqlite', dialect: sqliteProviderServices.dialect,
        migrationDialect: sqliteProviderServices.migrationDialect, createMigrationBuilder: sqliteProviderServices.createMigrationBuilder,
        createConnection };
    const model = indexIdentityModel(['ux_same', 'UX_SAME']);
    expect(() => bootstrapDbContext(options => options.useDataSource(source), builder => {
        jest.spyOn(builder, 'build').mockReturnValue(model);
    })).toThrow(ModelValidationError);
    expect(createConnection).not.toHaveBeenCalled();
});
