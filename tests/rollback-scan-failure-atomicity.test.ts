import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import {
    ContextStateRestorationError,
    DbContext,
    valueConverter,
} from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { generatedRelationshipTarget } from '../src/tracking/generated-relationship-target-store';
import type { EntityEntry as InternalEntityEntry } from '../src/tracking/entity-entry';
import type { TrackedRelationshipMetadata } from '../src/tracking/tracked-relationship-metadata';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import { internalEntityEntry } from './support/public-api-internals';

type ScanFailureMode = 'FK getter' | 'FK converter' | 'tenant getter' |
    'tenant converter' | 'navigation getter';
let activeFailureMode: ScanFailureMode | undefined;
let activeScanFailure: Error | undefined;

function scanFailure(): Error {
    return activeScanFailure ?? new Error('Expected an active scan failure.');
}

const foreignKeyConverter = valueConverter<number, number>({
    toProvider: value => {
        if (activeFailureMode === 'FK converter' && value === 41) {
            throw scanFailure();
        }
        return value;
    },
    fromProvider: value => value,
});

const tenantConverter = valueConverter<string, string>({
    toProvider: value => {
        if (activeFailureMode === 'tenant converter' && value === 'TENANT') {
            throw scanFailure();
        }
        return value.toLowerCase();
    },
    fromProvider: value => value,
});

class ScanParent {
    private storedId = 0;
    public name = '';
    public tenantId = '';
    public createdAt?: Date;
    public onGenerated?: (value: number) => void;
    public get id(): number {
        return this.storedId;
    }
    public set id(value: number) {
        this.storedId = value;
        if (value > 0) this.onGenerated?.(value);
    }
}

class ScanChild {
    private storedParentId = 0;
    private storedParent: ScanParent | null = null;
    private storedTenantId = '';
    public id = '';
    public throwOnScan = false;
    public get parentId(): number {
        if (this.throwOnScan && activeFailureMode === 'FK getter') {
            throw scanFailure();
        }
        return this.storedParentId;
    }
    public set parentId(value: number) {
        this.storedParentId = value;
    }
    public get parent(): ScanParent | null {
        if (this.throwOnScan && activeFailureMode === 'navigation getter') {
            throw scanFailure();
        }
        return this.storedParent;
    }
    public set parent(value: ScanParent | null) {
        this.storedParent = value;
    }
    public unsafeParentId(): number {
        return this.storedParentId;
    }
    public get tenantId(): string {
        if (this.throwOnScan && activeFailureMode === 'tenant getter') {
            throw scanFailure();
        }
        return this.storedTenantId;
    }
    public set tenantId(value: string) {
        this.storedTenantId = value;
    }
}

class LaterFailure {
    public id = '';
    public label = '';
    public tenantId = '';
}

class RollbackScanContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public parents = this.set(ScanParent);
    public children = this.set(ScanChild);
    public failures = this.set(LaterFailure);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(RollbackScanContext.connection, {
            provider: postgresDialect.name, dialect: postgresDialect,
        }).useAuditing({
            now: () => new Date('2026-08-14T13:00:00.000Z'),
        }).useTenantScope(() => 'tenant');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ScanParent, entity => {
            entity.toTable('scan_parents');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.audit({ createdAt: row => row.createdAt });
            entity.property(row => row.createdAt).hasColumnName('created_at')
                .hasColumnType('timestamp').isOptional();
        });
        model.entity(ScanChild, entity => {
            entity.toTable('scan_children');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').hasConversion(foreignKeyConverter)
                .isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').hasConversion(tenantConverter)
                .isRequired();
            entity.hasOne(ScanParent, row => row.parent)
                .withMany().hasForeignKey(row => row.parentId);
        });
        model.entity(LaterFailure, entity => {
            entity.toTable('scan_failures');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
        });
    }
}

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
    const values: T[] = [];
    for await (const row of rows) values.push(row);
    return values;
}

describe('rollback scan failure atomicity', () => {
    afterEach(() => {
        activeFailureMode = undefined;
        activeScanFailure = undefined;
    });

    it.each([
        'FK getter', 'FK converter', 'tenant getter',
        'tenant converter', 'navigation getter',
    ] as const)(
        'survives a throwing %s without partial cleanup', async failureMode => {
            activeFailureMode = undefined;
            activeScanFailure = undefined;
            const connection = new RecordingDatabaseConnection();
            RollbackScanContext.connection = connection;
            const db = RollbackScanContext.create();
            const scanFailure = new Error('rollback FK getter failed');
            const providerFailure = new Error('later provider write failed');
            const early = Object.assign(new ScanChild(), {
                id: 'early', parentId: 1, tenantId: 'tenant',
            });
            const throwing = Object.assign(new ScanChild(), {
                id: 'throwing', parentId: 1, tenantId: 'tenant',
            });
            const victim = Object.assign(new ScanChild(), {
                id: 'victim', parentId: 1, tenantId: 'tenant',
            });
            db.children.attach(early);
            db.children.attach(throwing);
            db.children.attach(victim);
            const parent = Object.assign(new ScanParent(), {
                name: 'generated', tenantId: 'tenant',
                onGenerated: (value: number) => {
                    activeFailureMode = failureMode;
                    activeScanFailure = scanFailure;
                    early.parentId = value;
                    throwing.parentId = value;
                    throwing.tenantId = 'TENANT';
                    throwing.throwOnScan = true;
                    victim.parentId = value;
                },
            });
            db.parents.add(parent);
            db.failures.add(Object.assign(new LaterFailure(), {
                id: 'failure', label: 'failure', tenantId: 'tenant',
            }));
            connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });
            connection.queueError(providerFailure);

            await expect(db.saveChanges()).rejects.toBe(providerFailure);
            expect(parent.id).toBe(0);
            expect(parent.createdAt).toBeUndefined();
            expect(victim.unsafeParentId()).toBe(41);
            const publicEarlyEntry = db.entry(early);
            if (!publicEarlyEntry) throw new Error('Expected the early child.');
            const earlyEntry = internalEntityEntry(publicEarlyEntry) as unknown as
                InternalEntityEntry<object>;
            const relationship = earlyEntry.metadata.relationships[0] as
                TrackedRelationshipMetadata;
            expect(generatedRelationshipTarget(
                earlyEntry,
                relationship,
            )).toBeUndefined();

            let unusable: unknown;
            try {
                await db.parents.count();
            } catch (error) {
                unusable = error;
            }
            expect(unusable).toBeInstanceOf(ContextStateRestorationError);
            expect(unusable).toMatchObject({
                cause: scanFailure,
                details: { phase: 'rollback' },
            });
            await expect(collect(db.parents.stream())).rejects.toBe(unusable);
            await expect(db.saveChanges()).rejects.toBe(unusable);
            await expect(db.transaction(() => undefined)).rejects.toBe(unusable);
            expect(() => db.getSavePlan()).toThrow(unusable as Error);
            expect(() => db.children.attach(new ScanChild()))
                .toThrow(unusable as Error);
            expect(() => {
                db.changeTracker.detectChanges();
            })
                .toThrow(unusable as Error);
            expect(() => {
                db.changeTracker.clear();
            }).toThrow(unusable as Error);
            expect(() => db.entry(victim)?.detectChanges())
                .toThrow(unusable as Error);
            expect(connection.statements).toHaveLength(2);
            await db.dispose();
        });
});
