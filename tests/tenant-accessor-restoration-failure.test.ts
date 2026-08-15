import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { ContextStateRestorationError, DbContext } from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class FragileTenantRow {
    private storedTenantId?: string;
    public id = '';
    public label = '';
    public stampFailure: unknown;
    public failStamp = false;
    public restorationFailure?: Error;

    public get tenantId(): string | undefined {
        return this.storedTenantId;
    }
    public set tenantId(value: string | undefined) {
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

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(FragileTenantContext.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        }).useTenantScope(() => 'tenant-one');
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

function open(): FragileTenantContext {
    FragileTenantContext.connection = new RecordingDatabaseConnection();
    return FragileTenantContext.create();
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
