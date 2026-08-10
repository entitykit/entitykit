import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { ContextStateRestorationError, DbContext } from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class FragileGeneratedRow {
    private storedId = 0;
    public sku = '';
    public label = '';
    public failRestoration?: Error;

    public get id(): number {
        return this.storedId;
    }

    public set id(value: number) {
        if (value === 0 && this.failRestoration) {
            throw this.failRestoration;
        }
        this.storedId = value;
    }
}

class RestorationFailureContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public rows = this.set(FragileGeneratedRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(RestorationFailureContext.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
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
        expect(() => db.rows.attach(first)).not.toThrow();

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
