import type { DbContextOptionsBuilder, ModelBuilder, SaveChangesInterceptor } from '../packages/core/src';
import { ContextStateRestorationError, DbContext } from '../packages/core/src';
import { postgresDialect } from '../packages/postgres/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class FragileTenantRow {
    private storedTenantId?: string;
    public id = '';
    public label = '';
    public stampFailure: unknown;
    public failStamp = false;
    public refuseStamp = false;
    public refuseRestoration = false;
    public restorationFailure?: Error;

    public get tenantId(): string | undefined {
        return this.storedTenantId;
    }
    public set tenantId(value: string | undefined) {
        if (value === undefined && this.refuseRestoration || value !== undefined && this.refuseStamp) return;
        if (value === undefined && this.restorationFailure) {
            throw this.restorationFailure;
        }
        this.storedTenantId = value;
        if (value !== undefined && this.failStamp) throw this.stampFailure;
    }
}

class FragileTenantContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public rows = this.set(FragileTenantRow);

    constructor(private readonly interceptor?: SaveChangesInterceptor) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(FragileTenantContext.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        }).useTenantScope(() => 'tenant-one');
        if (this.interceptor) options.useSaveInterceptor(this.interceptor);
    }
    protected override model(model: ModelBuilder): void {
        model.entity(FragileTenantRow, entity => {
            entity.toTable('fragile_tenant_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.tenantKey(row => row.tenantId);
        });
    }
}

function open(interceptor?: SaveChangesInterceptor): FragileTenantContext {
    FragileTenantContext.connection = new RecordingDatabaseConnection();
    return FragileTenantContext.create(interceptor);
}

function row(id: string): FragileTenantRow {
    return Object.assign(new FragileTenantRow(), { id, label: id });
}

async function rejected(action: () => unknown): Promise<unknown> {
    let didReject = false;
    let reason: unknown;
    try {
        await action();
    } catch (error) {
        didReject = true;
        reason = error;
    }
    expect(didReject).toBe(true);
    return reason;
}

async function expectPoisoned(
    db: FragileTenantContext,
    restoration: Error,
): Promise<void> {
    const unusable = await rejected(async () => db.rows.count());
    expect(unusable).toBeInstanceOf(ContextStateRestorationError);
    expect(unusable).toMatchObject({ cause: restoration });
    const next = row('next');
    expect(await rejected(() => db.rows.add(next))).toBe(unusable);
    expect(await rejected(() => db.rows.attach(next))).toBe(unusable);
    expect(await rejected(() => {
        db.changeTracker.clear();
    })).toBe(unusable);
    expect(await rejected(() => db.getSavePlan())).toBe(unusable);
    await expect(db.transaction(() => undefined)).rejects.toBe(unusable);
}

describe('tenant accessor restoration failure', () => {
    it('identifies an add-time tenant assignment refusal before tracking or SQL', async () => {
        const db = open();
        const candidate = row('refused-add');
        candidate.refuseStamp = true;
        expect(await rejected(() => db.rows.add(candidate))).toEqual(
            new Error('Property \'FragileTenantRow.tenantId\' refused its assigned value.'),
        );
        expect(candidate.tenantId).toBeUndefined();
        expect(db.entry(candidate)).toBeUndefined();
        expect(FragileTenantContext.connection.statements).toEqual([]);
        db.rows.add(row('accepted'));
        await db.dispose();
    });

    it('identifies a save-time tenant assignment refusal without losing the pending entity', async () => {
        const db = open();
        const candidate = row('refused-save');
        const entry = db.rows.add(candidate);
        candidate.tenantId = undefined;
        candidate.refuseStamp = true;
        await expect(db.saveChanges()).rejects.toThrow(
            'Property \'FragileTenantRow.tenantId\' refused its assigned value.',
        );
        expect(db.entry(candidate)).toBe(entry);
        expect(candidate.tenantId).toBeUndefined();
        expect(FragileTenantContext.connection.statements).toEqual([]);
        candidate.refuseStamp = false;
        expect(db.getSavePlan()).toHaveLength(1);
        await db.dispose();
    });

    it('identifies an add rollback refusal while preserving its tracking-collision error', async () => {
        const db = open();
        db.rows.add(row('collision'));
        const candidate = row('collision');
        candidate.refuseRestoration = true;
        const failure = await rejected(() => db.rows.add(candidate));
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain('already tracked');
        expect(candidate.tenantId).toBe('tenant-one');
        expect(db.entry(candidate)).toBeUndefined();
        await expectTenantRollbackRefusal(db);
        expect(FragileTenantContext.connection.statements).toEqual([]);
        await db.dispose();
    });

    it('identifies a save rollback refusal while preserving its interceptor error', async () => {
        const primary = new Error('application stopped the save');
        const db = open({ savingChanges: () => {
            throw primary;
        } });
        const candidate = row('rollback-save');
        db.rows.add(candidate);
        candidate.tenantId = undefined;
        candidate.refuseRestoration = true;
        await expect(db.saveChanges()).rejects.toBe(primary);
        expect(candidate.tenantId).toBe('tenant-one');
        expect(db.entry(candidate)).toBeDefined();
        await expectTenantRollbackRefusal(db);
        expect(FragileTenantContext.connection.statements).toEqual([]);
        await db.dispose();
    });

    it('preserves add stamping failures and leaves the failed entity untracked', async () => {
        const db = open();
        const candidate = row('add');
        const primary = 23;
        const restoration = new Error('add tenant restoration failed');
        candidate.failStamp = true;
        candidate.stampFailure = primary;
        candidate.restorationFailure = restoration;

        expect(await rejected(() => db.rows.add(candidate))).toBe(primary);
        expect(candidate.tenantId).toBe('tenant-one');
        expect(db.entry(candidate)).toBeUndefined();
        await expectPoisoned(db, restoration);
    });

    it('preserves a tracking collision when tenant rollback fails', async () => {
        const db = open();
        db.rows.add(row('duplicate'));
        const candidate = row('duplicate');
        const restoration = new Error('collision tenant restoration failed');
        candidate.restorationFailure = restoration;

        const primary = await rejected(() => db.rows.add(candidate));
        expect(primary).toBeInstanceOf(Error);
        expect((primary as Error).message).toContain('already tracked');
        expect(candidate.tenantId).toBe('tenant-one');
        expect(db.entry(candidate)).toBeUndefined();
        await expectPoisoned(db, restoration);
    });

    it('preserves upsert stamping failures and poisons before SQL', async () => {
        const db = open();
        const candidate = row('upsert');
        const primary = 'upsert tenant setter failed';
        const restoration = new Error('upsert tenant restoration failed');
        candidate.failStamp = true;
        candidate.stampFailure = primary;
        candidate.restorationFailure = restoration;

        expect(await rejected(async () => db.rows.upsert([candidate]))).toBe(primary);
        expect(candidate.tenantId).toBe('tenant-one');
        expect(FragileTenantContext.connection.statements).toEqual([]);
        await expectPoisoned(db, restoration);
    });
});

async function expectTenantRollbackRefusal(db: FragileTenantContext): Promise<void> {
    const failure = await rejected(async () => db.rows.count());
    expect(failure).toBeInstanceOf(ContextStateRestorationError);
    const cause = (failure as ContextStateRestorationError).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toBe('Property \'FragileTenantRow.tenantId\' refused its restoration value.');
}
