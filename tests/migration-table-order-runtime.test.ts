import { collectDestructiveWarnings, diffModelSnapshots } from '../packages/core/src/migrations/api';
import { ModelDiffMigration, migrationFromOperations } from '../packages/core/src/migrations/model-diff-migrations';
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

describe.each(providers)('$name generated and runtime migration contracts', ({ services }) => {
    it('preserves rebuild operations and their granular alternative in both directions', () => {
        const previous = emailClaimSnapshot();
        const target = {
            ...previous,
            entities: previous.entities.map(entity => entity.entityName === 'User' ? {
                ...entity,
                properties: entity.properties.map(property => property.propertyName === 'email' ? { ...property, isRequired: false } : property),
            } : {
                ...entity,
                relationships: entity.relationships.map(relationship => ({ ...relationship, deleteBehavior: 'cascade' as const })),
            }),
        };
        const generated = scaffoldedMigration(previous, target).migration;
        const runtime = diffModelSnapshots(previous, target).toMigration('rebuild-runtime', 'RebuildRuntime');
        for (const direction of ['up', 'down'] as const) {
            const actual = services.createMigrationBuilder();
            const expected = services.createMigrationBuilder();
            generated[direction](actual);
            runtime[direction](expected);
            if (actual.requiresTableRebuild) {
                expect(actual.statements).toEqual(expected.statements);
            } else {
                const bySql = (left: { text: string }, right: { text: string }): number => left.text.localeCompare(right.text);
                expect([...actual.statements].sort(bySql)).toEqual([...expected.statements].sort(bySql));
                const drop = actual.statements.findIndex(statement => /drop (constraint|foreign key)/.test(statement.text));
                const add = actual.statements.findIndex(statement => statement.text.includes('add constraint'));
                expect(drop).toBeGreaterThanOrEqual(0);
                expect(add).toBeGreaterThan(drop);
            }
            expect(actual.statements.length).toBeGreaterThan(0);
        }
        expect(runtime.id).toBe('rebuild-runtime');
        expect(runtime.name).toBe('RebuildRuntime');
        expect(runtime.destructiveWarnings).toEqual(collectDestructiveWarnings(diffModelSnapshots(previous, target).operations));
        expect(Object.isFrozen(runtime.destructiveWarnings)).toBe(true);
    });

    it.each(['class', 'factory'] as const)('retains the raw %s migration identity, ordered operations and inverse', creation => {
        const target = emailClaimSnapshot({ chain: true });
        const operations = Object.freeze(diffModelSnapshots(emptySnapshot, target).operations);
        const migration = creation === 'class' ? new ModelDiffMigration('raw-id', 'RawMigration', operations)
            : migrationFromOperations('raw-id', 'RawMigration', operations);
        expect(migration.id).toBe('raw-id');
        expect(migration.name).toBe('RawMigration');
        if (migration instanceof ModelDiffMigration) expect(migration.operations).toBe(operations);
        const generated = scaffoldedMigration(emptySnapshot, target).migration;
        for (const direction of ['up', 'down'] as const) {
            const actual = services.createMigrationBuilder();
            const expected = services.createMigrationBuilder();
            migration[direction](actual);
            generated[direction](expected);
            expect(actual.statements).toEqual(expected.statements);
            expect(actual.statements.length).toBeGreaterThan(0);
        }
        expect(migration.destructiveWarnings).toEqual([]);
        expect(Object.isFrozen(migration.destructiveWarnings)).toBe(true);
    });
});

describe('reviewable migration warning metadata', () => {
    it('retains immutable destructive warnings on both runtime migration forms', () => {
        const diff = diffModelSnapshots(emailClaimSnapshot(), emptySnapshot);
        const expected = collectDestructiveWarnings(diff.operations);
        expect(expected.length).toBeGreaterThan(0);
        for (const migration of [diff.toMigration('snapshot-id', 'SnapshotRemoval'), migrationFromOperations('raw-id', 'RawRemoval', diff.operations)]) {
            expect(migration.destructiveWarnings).toEqual(expected);
            expect(Object.isFrozen(migration.destructiveWarnings)).toBe(true);
        }
    });

    it('emits empty migrations without provider statements', () => {
        const { source, migration } = scaffoldedMigration(emptySnapshot, emptySnapshot);
        expect(source).toContain('override up(');
        expect(source).toContain('override down(');
        const builder = postgresProviderServices.createMigrationBuilder();
        migration.up(builder);
        migration.down(builder);
        expect(builder.statements).toEqual([]);
    });
});
