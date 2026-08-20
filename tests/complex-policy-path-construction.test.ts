import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class AuditStamp {
    public updatedAt?: Date;
    public deletedAt?: Date | null;
}

class AuditedRow {
    public id = '';
    public name = '';
    public audit: AuditStamp | null = null;
}

class AuditContext extends DbContext {
    public rows = this.set(AuditedRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:').useAuditing({
            now: () => new Date('2026-08-06T12:00:00.000Z'),
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(AuditedRow, entity => {
            entity.toTable('audited_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.audit({ updatedAt: row => row.audit.updatedAt });
            entity.softDelete(row => row.audit.deletedAt);
            entity.complexProperty(
                row => row.audit,
                { constructor: AuditStamp },
                audit => {
                    audit.property(value => value.updatedAt)
                        .hasColumnName('updated_at').hasColumnType('timestamptz');
                    audit.property(value => value.deletedAt)
                        .hasColumnName('deleted_at').hasColumnType('timestamptz');
                },
            );
        });
    }
}

class TenantStamp {
    public tenantId?: string;
}

class TenantRow {
    public id = '';
    public name = '';
    public scope: TenantStamp | null = null;
}

class TenantContext extends DbContext {
    public rows = this.set(TenantRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => 'tenant-1');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(TenantRow, entity => {
            entity.toTable('tenant_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.tenantKey(row => row.scope.tenantId);
            entity.complexProperty(
                row => row.scope,
                { constructor: TenantStamp },
                scope => scope.property(value => value.tenantId)
                    .hasColumnName('tenant_id').hasColumnType('text'),
            );
        });
    }
}

describe('complex policy path construction', () => {
    it('restores a missing audit ancestor after save-plan inspection', async () => {
        const db = AuditContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await db.database.connection.query({
            text: 'insert into audited_rows (id, name) values (?, ?)',
            values: ['row-1', 'before'],
        });
        const row = requireDefined(await db.rows.find('row-1'));
        row.name = 'after';

        expect(db.getSavePlan()).toHaveLength(1);
        expect(row.audit).toBeNull();

        await db.saveChanges();
        expect(row.audit).toBeInstanceOf(AuditStamp);
        expect(row.audit?.updatedAt).toEqual(
            new Date('2026-08-06T12:00:00.000Z'),
        );
        await db.dispose();
    });

    it('uses the configured constructor for nested tenant stamping', async () => {
        const db = TenantContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        const row = Object.assign(new TenantRow(), { id: 'row-1', name: 'one' });

        db.rows.add(row);
        expect(row.scope).toBeInstanceOf(TenantStamp);
        expect(row.scope?.tenantId).toBe('tenant-1');

        const bulk = Object.assign(new TenantRow(), { id: 'row-2', name: 'two' });
        await db.rows.upsert([bulk]);
        expect(bulk.scope).toBeInstanceOf(TenantStamp);
        expect(bulk.scope?.tenantId).toBe('tenant-1');
        await db.dispose();
    });

    it('constructs one typed ancestor for soft-delete and audit writes', async () => {
        const db = AuditContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await db.database.connection.query({
            text: 'insert into audited_rows (id, name) values (?, ?)',
            values: ['row-1', 'before'],
        });
        const row = requireDefined(await db.rows.find('row-1'));
        db.rows.remove(row);

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(row.audit).toBeInstanceOf(AuditStamp);
        expect(row.audit?.deletedAt).toEqual(
            new Date('2026-08-06T12:00:00.000Z'),
        );
        expect(row.audit?.updatedAt).toEqual(row.audit?.deletedAt);
        await db.dispose();
    });

    it('removes a created tenant ancestor when add tracking fails', () => {
        const db = TenantContext.create();
        db.rows.add(Object.assign(new TenantRow(), {
            id: 'duplicate',
            name: 'accepted',
        }));
        const rejected = Object.assign(new TenantRow(), {
            id: 'duplicate',
            name: 'rejected',
        });

        expect(() => db.rows.add(rejected)).toThrow('already tracked');
        expect(rejected.scope).toBeNull();
        expect(db.entry(rejected)).toBeUndefined();
    });
});
