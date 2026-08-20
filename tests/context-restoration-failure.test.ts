import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { ContextStateRestorationError, DbContext } from '../packages/core/src';
import { postgresDialect } from '../packages/postgres/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class FragileGeneratedRow {
    private storedId = 0;
    private storedCreatedAt?: Date;
    public sku = '';
    public label = '';
    public failRestoration?: Error;
    public failCreatedAtRestoration?: Error;

    public get id(): number {
        return this.storedId;
    }

    public set id(value: number) {
        if (value === 0 && this.failRestoration) {
            throw this.failRestoration;
        }
        this.storedId = value;
    }
    public get createdAt(): Date | undefined {
        return this.storedCreatedAt;
    }
    public set createdAt(value: Date | undefined) {
        if (value === undefined && this.failCreatedAtRestoration) {
            throw this.failCreatedAtRestoration;
        }
        this.storedCreatedAt = value;
    }
}

class RestorationFailureContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public rows = this.set(FragileGeneratedRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(RestorationFailureContext.connection, {
            provider: postgresDialect.name, dialect: postgresDialect,
        }).useAuditing({
            now: () => new Date('2026-08-14T12:00:00.000Z'),
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(FragileGeneratedRow, entity => {
            entity.toTable('fragile_generated_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
            entity.property(row => row.sku).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.audit({ createdAt: row => row.createdAt });
            entity.property(row => row.createdAt).hasColumnName('created_at')
                .hasColumnType('timestamp').isOptional();
            entity.hasIndex(row => row.sku).isUnique();
        });
    }
}

function open(connection: RecordingDatabaseConnection): RestorationFailureContext {
    RestorationFailureContext.connection = connection;
    return RestorationFailureContext.create();
}

describe('context transaction state restoration failures', () => {
    it('preserves an immediate provider failure and poisons later database use', async () => {
        const connection = new RecordingDatabaseConnection();
        const providerFailure = new Error('later batch failed');
        const restorationFailure = new Error('generated setter refused restoration');
        connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });
        connection.queueError(providerFailure);
        const db = open(connection);
        const first = Object.assign(new FragileGeneratedRow(), {
            sku: 'sku-one',
            label: 'one',
            failRestoration: restorationFailure,
        });
        const second = Object.assign(new FragileGeneratedRow(), {
            sku: 'sku-two',
            label: 'two',
        });

        await expect(db.rows.upsert([first, second], {
            conflictProperties: ['sku'],
            updateProperties: ['label'],
        })).rejects.toBe(providerFailure);
        expect(first.id).toBe(41);
        expect(second.id).toBe(0);
        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        let unusable: unknown;
        try {
            await db.rows.count();
        } catch (error) {
            unusable = error;
        }
        expect(unusable).toBeInstanceOf(ContextStateRestorationError);
        expect(unusable).toMatchObject({
            code: 'CONTEXT_STATE_RESTORATION_FAILED',
            cause: restorationFailure,
            details: { phase: 'rollback' },
        });
        expect(() => db.rows.attach(first)).toThrow(unusable as Error);
        expect(() => {
            db.changeTracker.clear();
        }).toThrow(unusable as Error);
        expect(() => db.getSavePlan()).toThrow(unusable as Error);
        await expect(db.transaction(() => undefined)).rejects.toBe(unusable);
        expect(connection.statements).toHaveLength(2);
    });

    it('attempts every tracked cleanup and retains all restoration failures', async () => {
        const connection = new RecordingDatabaseConnection();
        const providerFailure = new Error('later tracked insert failed');
        const restorationFailure = new Error('tracked ID refused restoration');
        const auditFailure = new Error('audit setter refused restoration');
        connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });
        connection.queueError(providerFailure);
        const db = open(connection);
        const first = Object.assign(new FragileGeneratedRow(), {
            sku: 'tracked-one', label: 'one',
            failRestoration: restorationFailure,
            failCreatedAtRestoration: auditFailure,
        });
        const second = Object.assign(new FragileGeneratedRow(), {
            sku: 'tracked-two', label: 'two',
        });
        db.rows.add(first);
        db.rows.add(second);

        await expect(db.saveChanges()).rejects.toBe(providerFailure);
        expect(first.id).toBe(41);
        expect(first.createdAt).toEqual(
            new Date('2026-08-14T12:00:00.000Z'),
        );
        expect(second.createdAt).toBeUndefined();

        let unusable: unknown;
        try {
            await db.rows.count();
        } catch (error) {
            unusable = error;
        }
        expect(unusable).toBeInstanceOf(ContextStateRestorationError);
        expect(unusable).toMatchObject({
            code: 'CONTEXT_STATE_RESTORATION_FAILED',
            details: { phase: 'rollback' },
        });
        const cause = (unusable as Error).cause;
        expect(cause).toBeInstanceOf(AggregateError);
        if (!(cause instanceof AggregateError)) {
            throw new Error('Expected aggregated restoration failures.');
        }
        expect(cause.errors).toEqual([
            restorationFailure,
            auditFailure,
        ]);
        expect(connection.statements).toHaveLength(2);
    });

    it('preserves the transaction error and rejects later context use', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });
        const db = open(connection);
        const row = Object.assign(new FragileGeneratedRow(), {
            sku: 'sku-one',
            label: 'one',
        });
        const transactionFailure = new Error('outer transaction failed');
        const restorationFailure = new Error('generated setter refused rollback');

        const pending = db.transaction(async transaction => {
            await transaction.rows.upsert([row], {
                conflictProperties: ['sku'],
                updateProperties: ['label'],
            });
            row.failRestoration = restorationFailure;
            throw transactionFailure;
        });

        await expect(pending).rejects.toBe(transactionFailure);
        expect(row.id).toBe(41);
        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'release:entitykit_sp_1',
            'rollback',
        ]);

        let unusable: unknown;
        try {
            await db.rows.count();
        } catch (error) {
            unusable = error;
        }
        expect(unusable).toBeInstanceOf(ContextStateRestorationError);
        expect(unusable).toMatchObject({
            code: 'CONTEXT_STATE_RESTORATION_FAILED',
            cause: restorationFailure,
            details: { phase: 'rollback' },
        });
        await expect(db.transaction(() => undefined)).rejects.toBe(unusable);
        expect(connection.statements).toHaveLength(1);
    });
});
