import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { ModelSnapshot } from '../packages/core/src/tooling';
import {
    renderSnapshotSource,
    scaffoldMigration,
} from '../packages/core/src/migrations/api';
import { createManagedTempDirectory } from './support/managed-temp-directory';
import { planningSnapshot } from './support/sqlite-planning-support';

class Account {
    public id!: string;
    public email!: string;
    public score!: number;
    public normalizedEmail!: string;
    public sessions!: Session[];
}

class Session {
    public id!: string;
    public accountId!: string;
    public account!: Account;
}

function createSnapshot(collation: string): ModelSnapshot {
    return new ModelBuilderImplementation()
        .hasSequence('account_numbers', sequence => sequence
            .hasSchema('app')
            .startsAt(100)
            .incrementsBy(10))
        .entity(Account, entity => {
            entity.toTable('accounts', 'app');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('uuid').isRequired();
            entity.property(row => row.email)
                .hasColumnType('text')
                .isRequired()
                .useCollation(collation);
            entity.property(row => row.score).hasColumnType('integer').isRequired();
            entity.property(row => row.normalizedEmail)
                .hasColumnType('text')
                .hasComputedColumnSql('lower(email)');
            entity.hasCheckConstraint('ck_accounts_score', 'score >= 0');
            entity.hasExpressionIndex('lower(email)')
                .hasDatabaseName('ix_accounts_email')
                .includeProperties(row => row.score)
                .hasFilter('score > 0');
        })
        .entity(Session, entity => {
            entity.toTable('sessions', 'app');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('uuid').isRequired();
            entity.property(row => row.accountId).hasColumnType('uuid').isRequired();
            entity.hasOne(Account, row => row.account)
                .withMany(account => account.sessions)
                .hasForeignKey(row => row.accountId);
        })
        .build()
        .toSnapshot();
}

describe('generated migration source', () => {
    it.each(['table', 'sequence'] as const)('places a rebuild before a removed %s in compilable provider-portable source', kind => {
        const directory = tempDir();
        const snapshotPath = path.join(directory, 'EntityKitModelSnapshot.ts');
        const base = planningSnapshot();
        const previous: ModelSnapshot = kind === 'table'
            ? { ...base, entities: [...base.entities, { ...base.entities[0], entityName: 'ArchivedRecord', tableName: 'archived_records' }] }
            : { ...base, sequences: [{ name: 'retired_numbers', isCyclic: false }] };
        const current = planningSnapshot({ optionalLabel: true });
        fs.writeFileSync(snapshotPath, renderSnapshotSource(previous), 'utf8');
        const source = scaffoldMigration({ createModelSnapshot: () => current }, {
            name: 'Change Planning Record', migrationsDir: directory, snapshotPath, now: new Date('2026-10-04T00:01:01Z'),
        }).migrationSource;
        const up = source.slice(source.indexOf('override up('), source.indexOf('override down('));
        const down = source.slice(source.indexOf('override down('));
        const drop = kind === 'table' ? 'builder.dropTable(' : 'builder.dropSequence(';
        const create = kind === 'table' ? 'builder.createTable(' : 'builder.createSequence(';

        expect(up).toContain(drop);
        expect(up).toContain('builder.rebuildTable(');
        expect(up.indexOf('builder.rebuildTable(')).toBeLessThan(up.indexOf(drop));
        expect(down).toContain(create);
        expect(down.indexOf(create)).toBeLessThan(down.indexOf('builder.rebuildTable('));
        expect(compileMigrationSource(source)).toEqual([]);
    });

    it('type-checks rich initial migrations without leaking diff-only fields', () => {
        const dir = tempDir();
        const snapshot = createSnapshot('C');
        const scaffold = scaffoldMigration(
            { createModelSnapshot: () => snapshot },
            {
                name: 'Rich Initial',
                migrationsDir: dir,
                snapshotPath: path.join(dir, 'EntityKitModelSnapshot.ts'),
                now: new Date('2026-07-31T12:00:00Z'),
            },
        );

        expect(compileMigrationSource(scaffold.migrationSource)).toEqual([]);
    });

    it('type-checks SQLite rebuild definitions with rich indexes and foreign keys', () => {
        const dir = tempDir();
        const snapshotPath = path.join(dir, 'EntityKitModelSnapshot.ts');
        fs.writeFileSync(
            snapshotPath,
            renderSnapshotSource(createSnapshot('C')),
            'utf8',
        );
        const scaffold = scaffoldMigration(
            { createModelSnapshot: () => createSnapshot('NOCASE') },
            {
                name: 'Change Collation',
                migrationsDir: dir,
                snapshotPath,
                now: new Date('2026-07-31T12:01:00Z'),
            },
        );

        expect(scaffold.migrationSource).toContain(
            'if (builder.requiresTableRebuild)',
        );
        expect(compileMigrationSource(scaffold.migrationSource)).toEqual([]);
    });

    it('rebuilds a dependent while its principal table and entity are renamed', () => {
        const dir = tempDir();
        const snapshotPath = path.join(dir, 'EntityKitModelSnapshot.ts');
        const previous = createSnapshot('C');
        fs.writeFileSync(
            snapshotPath,
            renderSnapshotSource(previous),
            'utf8',
        );
        const current: ModelSnapshot = {
            ...previous,
            entities: previous.entities.map(entity => {
                if (entity.entityName === 'Account') {
                    return {
                        ...entity,
                        entityName: 'Customer',
                        tableName: 'customers',
                    };
                }
                return {
                    ...entity,
                    properties: entity.properties.map(property =>
                        property.propertyName === 'accountId'
                            ? { ...property, collation: 'BINARY' }
                            : property),
                    relationships: entity.relationships.map(relationship => ({
                        ...relationship,
                        principalEntityName: 'Customer',
                    })),
                };
            }),
        };
        const scaffold = scaffoldMigration(
            { createModelSnapshot: () => current },
            {
                name: 'Rename Account',
                migrationsDir: dir,
                snapshotPath,
                renameHints: {
                    tables: [{
                        from: 'accounts',
                        to: 'customers',
                        schemaName: 'app',
                    }],
                },
                now: new Date('2026-07-31T12:02:00Z'),
            },
        );

        expect(scaffold.migrationSource).toContain(
            '"principalTableName": "customers"',
        );
        expect(compileMigrationSource(scaffold.migrationSource)).toEqual([]);
    });
});

function tempDir(): string {
    return createManagedTempDirectory('entitykit-migration-source-');
}

function compileMigrationSource(source: string): readonly string[] {
    const dir = tempDir();
    const migrationPath = path.join(dir, 'GeneratedMigration.ts');
    fs.writeFileSync(migrationPath, source, 'utf8');
    const options: ts.CompilerOptions = {
        baseUrl: dir,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        noEmit: true,
        noImplicitOverride: true,
        paths: {
            '@entitykit/core/migrations': [
                path.resolve(__dirname, '../packages/core/src/migrations/api.ts'),
            ],
        },
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        types: ['node'],
    };
    const program = ts.createProgram([migrationPath], options);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    fs.rmSync(dir, { recursive: true, force: true });
    return diagnostics.map(diagnostic =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}
