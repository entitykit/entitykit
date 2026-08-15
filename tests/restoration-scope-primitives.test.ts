import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    SaveChangesInterceptor,
} from '../src';
import { ContextStateRestorationError, DbContext } from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class PrimitiveFailureRow {
    private storedId = 0;
    private storedCreatedAt?: Date;
    public sku = '';
    public label = '';
    public failGenerated = false;
    public generatedFailure: unknown;
    public generatedRestorationFailure?: Error;
    public ignoreGeneratedRestoration = false;
    public failAudit = false;
    public auditFailure: unknown;
    public auditRestorationFailure?: Error;

    public get id(): number {
        return this.storedId;
    }
    public set id(value: number) {
        if (value === 0 && this.ignoreGeneratedRestoration) return;
        if (value === 0 && this.generatedRestorationFailure) {
            throw this.generatedRestorationFailure;
        }
        this.storedId = value;
        if (value > 0 && this.failGenerated) throw this.generatedFailure;
    }
    public get createdAt(): Date | undefined {
        return this.storedCreatedAt;
    }
    public set createdAt(value: Date | undefined) {
        if (!value && this.auditRestorationFailure) {
            throw this.auditRestorationFailure;
        }
        this.storedCreatedAt = value;
        if (value && this.failAudit) throw this.auditFailure;
    }
}

class PrimitiveFailureContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public static interceptor?: SaveChangesInterceptor;
    public rows = this.set(PrimitiveFailureRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(PrimitiveFailureContext.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        }).useAuditing({
            now: () => new Date('2026-08-14T12:00:00.000Z'),
        });
        if (PrimitiveFailureContext.interceptor) {
            options.useSaveInterceptor(PrimitiveFailureContext.interceptor);
        }
    }
    protected override model(model: ModelBuilder): void {
        model.entity(PrimitiveFailureRow, entity => {
            entity.toTable('primitive_failure_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
            entity.property(row => row.sku).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.hasIndex(row => row.sku).isUnique();
            entity.audit({ createdAt: row => row.createdAt });
            entity.property(row => row.createdAt).hasColumnName('created_at')
                .hasColumnType('timestamp').isOptional();
        });
    }
}

function open(interceptor?: SaveChangesInterceptor): {
    readonly db: PrimitiveFailureContext;
    readonly connection: RecordingDatabaseConnection;
} {
    const connection = new RecordingDatabaseConnection();
    PrimitiveFailureContext.connection = connection;
    PrimitiveFailureContext.interceptor = interceptor;
    return { db: PrimitiveFailureContext.create(), connection };
}

async function rejection(action: () => unknown): Promise<unknown> {
    let rejected = false;
    let reason: unknown;
    try {
        await action();
    } catch (error) {
        rejected = true;
        reason = error;
    }
    expect(rejected).toBe(true);
    return reason;
}

async function expectEveryOperationPoisoned(
    db: PrimitiveFailureContext,
    expectedCause: Error,
): Promise<void> {
    const unusable = await rejection(async () => db.rows.count());
    expect(unusable).toBeInstanceOf(ContextStateRestorationError);
    expect(unusable).toMatchObject({
        cause: expectedCause,
        details: { phase: 'rollback' },
    });
    const candidate = Object.assign(new PrimitiveFailureRow(), { sku: 'next' });
    expect(await rejection(() => db.rows.add(candidate))).toBe(unusable);
    expect(await rejection(() => db.rows.attach(candidate))).toBe(unusable);
    expect(await rejection(() => {
        db.changeTracker.clear();
    })).toBe(unusable);
    expect(await rejection(() => db.getSavePlan())).toBe(unusable);
    await expect(db.transaction(() => undefined)).rejects.toBe(unusable);
}

const primitiveFailures: ReadonlyArray<readonly [string, unknown]> = [
    ['Error', new Error('generated primary')],
    ['string', 'generated primary'],
    ['number', 17],
    ['symbol', Symbol('generated primary')],
    ['null', null],
    ['undefined', undefined],
];

describe('operation-scoped primitive restoration failures', () => {
    it.each(primitiveFailures)(
        'preserves an exact %s generated failure and poisons every boundary',
        async (_label, primary) => {
            const { db, connection } = open();
            connection.queueResult({ rows: [{ id: 1 }], rowCount: 1 });
            const restoration = new Error('generated restoration failed');
            const row = Object.assign(new PrimitiveFailureRow(), { sku: 'one' });
            db.rows.add(row);
            row.failGenerated = true;
            row.generatedFailure = primary;
            row.generatedRestorationFailure = restoration;

            expect(await rejection(async () => db.saveChanges())).toBe(primary);
            expect(row.id).toBe(1);
            await expectEveryOperationPoisoned(db, restoration);
            expect(connection.statements).toHaveLength(1);
        },
    );

    it.each([
        ['getSavePlan()', (db: PrimitiveFailureContext) => db.getSavePlan()],
        ['getSavePlanDebugView()', (
            db: PrimitiveFailureContext,
        ) => db.getSavePlanDebugView()],
    ] as const)(
        'fails closed when an audit setter mutates during %s',
        async (_label, inspect) => {
            const { db, connection } = open();
            const primary = Symbol('audit primary');
            const restoration = new Error('audit restoration failed');
            const row = Object.assign(new PrimitiveFailureRow(), { sku: 'audit' });
            db.rows.add(row);
            row.failAudit = true;
            row.auditFailure = primary;
            row.auditRestorationFailure = restoration;

            expect(await rejection(() => inspect(db))).toBe(primary);
            expect(row.createdAt).toEqual(
                new Date('2026-08-14T12:00:00.000Z'),
            );
            await expectEveryOperationPoisoned(db, restoration);
            expect(connection.statements).toEqual([]);
        },
    );

    it('preserves a primitive generated-value upsert failure', async () => {
        const { db, connection } = open();
        connection.queueResult({ rows: [{ id: 2 }], rowCount: 1 });
        const primary = 'generated upsert primary';
        const restoration = new Error('generated upsert restoration failed');
        const row = Object.assign(new PrimitiveFailureRow(), {
            sku: 'upsert', label: 'upsert', failGenerated: true,
            generatedFailure: primary,
            generatedRestorationFailure: restoration,
        });

        expect(await rejection(async () => db.rows.upsert([row], {
            conflictProperties: ['sku'],
            updateProperties: ['label'],
        }))).toBe(primary);
        expect(row.id).toBe(2);
        await expectEveryOperationPoisoned(db, restoration);
        expect(connection.statements).toHaveLength(1);
    });

    it('detects a setter that silently refuses restoration', async () => {
        const { db, connection } = open();
        connection.queueResult({ rows: [{ id: 3 }], rowCount: 1 });
        const primary = new Error('generated setter failed');
        const row = Object.assign(new PrimitiveFailureRow(), {
            sku: 'silent', label: 'silent', failGenerated: true,
            generatedFailure: primary,
            ignoreGeneratedRestoration: true,
        });
        db.rows.add(row);

        expect(await rejection(async () => db.saveChanges())).toBe(primary);
        expect(row.id).toBe(3);
        const unusable = await rejection(async () => db.rows.count());
        expect(unusable).toBeInstanceOf(ContextStateRestorationError);
        const cause = (unusable as Error).cause;
        expect(cause).toBeInstanceOf(Error);
        expect((cause as Error).message).toBe(
            'Property \'PrimitiveFailureRow.id\' refused its restoration value.',
        );
    });

    it('poisons when restoration throws an empty aggregate', async () => {
        const { db } = open();
        const primary = 'audit write failed';
        const restoration = new AggregateError([], 'empty audit restoration');
        const row = Object.assign(new PrimitiveFailureRow(), { sku: 'empty' });
        db.rows.add(row);
        row.failAudit = true;
        row.auditFailure = primary;
        row.auditRestorationFailure = restoration;

        expect(await rejection(() => db.getSavePlan())).toBe(primary);
        expect(row.createdAt).toEqual(
            new Date('2026-08-14T12:00:00.000Z'),
        );
        await expectEveryOperationPoisoned(db, restoration);
    });

    it('poisons when successful plan construction cannot clean up', async () => {
        const { db } = open();
        const restoration = new Error('final planning cleanup failed');
        const row = Object.assign(new PrimitiveFailureRow(), { sku: 'cleanup' });
        db.rows.add(row);
        row.auditRestorationFailure = restoration;

        expect(await rejection(() => db.getSavePlan())).toBe(restoration);
        expect(row.createdAt).toEqual(
            new Date('2026-08-14T12:00:00.000Z'),
        );
        await expectEveryOperationPoisoned(db, restoration);
    });

    it('poisons when interceptor plan regeneration cannot unwind', async () => {
        const { db } = open({ savingChanges: () => undefined });
        const restoration = new Error('plan regeneration cleanup failed');
        const row = Object.assign(new PrimitiveFailureRow(), {
            sku: 'regeneration', auditRestorationFailure: restoration,
        });
        db.rows.add(row);

        expect(await rejection(async () => db.saveChanges()))
            .toBe(restoration);
        expect(row.createdAt).toEqual(
            new Date('2026-08-14T12:00:00.000Z'),
        );
        await expectEveryOperationPoisoned(db, restoration);
    });
});
