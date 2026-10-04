import type { MigrationBuilder } from '../packages/core/src/migrations/api';
import { diffModelSnapshots } from '../packages/core/src/migrations/api';
import { postgresProviderServices } from '../packages/postgres/src';
import { mySqlProviderServices } from '../packages/mysql/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { emptySnapshot } from './model-differ-support';
import { emailClaimSnapshot, scaffoldedMigration } from './support/migration-table-order-support';

const providers = [
    { name: 'postgres', services: postgresProviderServices },
    { name: 'mysql', services: mySqlProviderServices },
    { name: 'sqlite', services: sqliteProviderServices },
];
const cases = [
    { name: 'email claim before user', options: {}, tables: ['ek_order_users', 'ek_order_email_claims'] },
    { name: 'three-table dependency chain', options: { chain: true }, tables: ['ek_order_users', 'ek_order_email_claims', 'ek_order_email_tokens'] },
    { name: 'self reference', options: { selfReference: true }, tables: ['ek_order_users', 'ek_order_email_claims'] },
];

function tableNames(builder: MigrationBuilder, kind: 'create' | 'drop'): string[] {
    return builder.statements.filter(statement => statement.text.startsWith(`${kind} table`))
        .map(statement => /ek_order_\w+/.exec(statement.text)?.[0] ?? '');
}

describe.each(providers)('$name dependency-aware migrations', ({ services }) => {
    it.each(cases)('creates parents first and rolls back populated $name tables in reverse dependency order', ({ options, tables }) => {
        const target = emailClaimSnapshot(options);
        const { migration } = scaffoldedMigration(emptySnapshot, target);
        const up = services.createMigrationBuilder();
        const down = services.createMigrationBuilder();
        migration.up(up);
        migration.down(down);
        expect(tableNames(up, 'create')).toEqual(tables);
        expect(tableNames(down, 'drop')).toEqual([...tables].reverse());
        expect(up.statements.filter(statement => statement.text.includes('references'))).toHaveLength(target.entities.length - 1 + Number(Boolean(options.selfReference)));
        if (up.canAlterTableConstraints) {
            const lastTable = up.statements.map(statement => statement.text.startsWith('create table')).lastIndexOf(true);
            expect(up.statements.slice(0, lastTable + 1).some(statement => statement.text.includes('references'))).toBe(false);
            const firstDrop = down.statements.findIndex(statement => statement.text.startsWith('drop table'));
            expect(down.statements.slice(firstDrop).some(statement => statement.text.startsWith('alter table'))).toBe(false);
        } else {
            expect(up.statements.every(statement => !statement.text.startsWith('alter table'))).toBe(true);
            expect(down.statements.every(statement => !statement.text.startsWith('alter table'))).toBe(true);
        }
    });

    it.each(cases)('recreates a removed $name schema in dependency order on down', ({ options, tables }) => {
        const previous = emailClaimSnapshot(options);
        const { migration } = scaffoldedMigration(previous, emptySnapshot);
        const up = services.createMigrationBuilder();
        const down = services.createMigrationBuilder();
        migration.up(up);
        migration.down(down);
        expect(tableNames(up, 'drop')).toEqual([...tables].reverse());
        expect(tableNames(down, 'create')).toEqual(tables);
        expect(down.statements.filter(statement => statement.text.includes('references'))).toHaveLength(previous.entities.length - 1 + Number(Boolean(options.selfReference)));
    });

    it('retains both sides of a cyclic relationship without inline forward references on altering providers', () => {
        const { migration } = scaffoldedMigration(emptySnapshot, emailClaimSnapshot({ cyclic: true }));
        const up = services.createMigrationBuilder();
        const down = services.createMigrationBuilder();
        migration.up(up);
        migration.down(down);
        expect(tableNames(up, 'create')).toHaveLength(2);
        expect(tableNames(down, 'drop')).toHaveLength(2);
        expect(up.statements.filter(statement => statement.text.includes('references'))).toHaveLength(2);
        if (up.canAlterTableConstraints) {
            const creates = up.statements.filter(statement => statement.text.startsWith('create table'));
            expect(creates.every(statement => !statement.text.includes('references'))).toBe(true);
            expect(down.statements.filter(statement => statement.text.startsWith('alter table'))).toHaveLength(2);
        }
    });

    it('orders runtime snapshot diffs as well as generated source', () => {
        const migration = diffModelSnapshots(emptySnapshot, emailClaimSnapshot({ chain: true })).toMigration('runtime-order', 'RuntimeOrder');
        const up = services.createMigrationBuilder();
        const down = services.createMigrationBuilder();
        migration.up(up);
        migration.down(down);
        expect(tableNames(up, 'create')).toEqual(['ek_order_users', 'ek_order_email_claims', 'ek_order_email_tokens']);
        expect(tableNames(down, 'drop')).toEqual(['ek_order_email_tokens', 'ek_order_email_claims', 'ek_order_users']);
    });
});
