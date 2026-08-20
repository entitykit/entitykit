import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

/** Tracked saves finalize in-memory acceptance before their transaction commits. */
class Row {
    public id!: string;
    public label!: string;
    public version!: number;

    constructor(data?: Partial<Row>) {
        Object.assign(this, data);
    }
}

class Other {
    public id!: string;
    public note!: string;

    constructor(data?: Partial<Other>) {
        Object.assign(this, data);
    }
}

let connection: RecordingDatabaseConnection;

class SaveDbContext extends DbContext {
    public rows = this.set(Row);
    public others = this.set(Other);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Row, entity => {
            entity.toTable('rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnName('label').hasColumnType('text').isRequired();
            entity.property(row => row.version).hasColumnName('version').hasColumnType('integer').isRequired().isVersion();
        });
        model.entity(Other, entity => {
            entity.toTable('others');
            entity.hasKey(other => other.id);
            entity.property(other => other.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(other => other.note).hasColumnName('note').hasColumnType('text').isRequired();
        });
    }
}

function open(affectedRows: readonly number[] = [1]): SaveDbContext {
    connection = new RecordingDatabaseConnection();
    const db =  SaveDbContext.create();
    for (const rowCount of affectedRows) {
        connection.queueResult({ rows: [], rowCount });
    }
    connection.transactionEvents.length = 0;
    return db;
}

describe('single-statement saves', () => {
    it('keeps a one-row statement and tracker acceptance in one transaction', async () => {
        const db =  open();
        db.rows.add(new Row({ id: 'a', label: 'one', version: 1 }));

        await db.saveChanges();

        expect(connection.statements).toHaveLength(1);
        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
        await db.dispose();
    });

    describe('still takes a transaction', () => {
        it('when the plan has more than one statement', async () => {
            const db =  open([1, 1]);
            // Two entity types cannot share an insert batch, so this is two
            // statements and they must succeed or fail together.
            db.rows.add(new Row({ id: 'a', label: 'one', version: 1 }));
            db.others.add(new Other({ id: 'b', note: 'two' }));

            await db.saveChanges();

            expect(connection.statements.length).toBeGreaterThan(1);
            expect(connection.transactionEvents).toEqual(['begin', 'commit']);
            await db.dispose();
        });

        it('when one statement writes several rows', async () => {
            // A batched insert is a single statement that can still affect fewer
            // rows than expected, and then the rows it did write need undoing. This
            // is the case that made the first version of the optimization wrong.
            const db =  open([2]);
            db.rows.add(new Row({ id: 'a', label: 'one', version: 1 }));
            db.rows.add(new Row({ id: 'b', label: 'two', version: 1 }));

            await db.saveChanges();

            expect(connection.statements).toHaveLength(1);
            expect(connection.transactionEvents).toEqual(['begin', 'commit']);
            await db.dispose();
        });

        it('when the save runs inside an explicit transaction', async () => {
            // A nested save takes a savepoint so a failure leaves the caller's
            // transaction usable. Skipping that would change what a failure does to
            // code that wrapped the save deliberately.
            const db =  open();

            await db.transaction(async () => {
                db.rows.add(new Row({ id: 'a', label: 'one', version: 1 }));
                await db.saveChanges();
            });

            expect(connection.transactionEvents[0]).toBe('begin');
            expect(connection.transactionEvents).toContain('commit');
            await db.dispose();
        });
    });

    it('reports a failed single-statement save exactly as before', async () => {
        const db =  open([]);
        connection.queueError(new Error('insert failed'));
        const row = new Row({ id: 'a', label: 'one', version: 1 });
        db.rows.add(row);

        await expect(db.saveChanges()).rejects.toThrow('insert failed');

        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(db.entry(row)?.state).toBe('Added');
        expect(row.version).toBe(1);
        await db.dispose();
    });

    it('still increments the version and accepts changes on success', async () => {
        const db =  open();
        const row = new Row({ id: 'a', label: 'one', version: 1 });
        db.rows.attach(row);
        row.label = 'changed';

        await db.saveChanges();

        expect(row.version).toBe(2);
        expect(db.entry(row)?.state).toBe('Unchanged');
        await db.dispose();
    });
});
