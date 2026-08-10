import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';

class TransitionRow {
    public id = '';
    public label = '';
    public note: string | null | undefined = null;
    public deletedAt: Date | null | undefined = null;
}

class TransitionContext extends DbContext {
    public rows = this.set(TransitionRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(TransitionRow, entity => {
            entity.toTable('transition_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.note).hasColumnType('text');
            entity.property(row => row.deletedAt).hasColumnName('deleted_at')
                .hasColumnType('timestamp');
            entity.softDelete(row => row.deletedAt);
        });
    }
}

async function open(): Promise<TransitionContext> {
    const db = TransitionContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    return db;
}

async function insertRaw(
    db: TransitionContext,
    id: string,
    marker: unknown,
): Promise<void> {
    await db.database.connection.query({
        text: 'insert into transition_rows (id, label, note, deleted_at) values (?, ?, ?, ?)',
        values: [id, 'one', null, marker],
    });
}

function updateSql(db: TransitionContext): string {
    return requireDefined(db.getSavePlan()[0]).statement.text;
}

describe('soft-delete transition SQL', () => {
    it('leaves a null live marker out of an ordinary business update', async () => {
        const db = await open();
        const row = Object.assign(new TransitionRow(), {
            id: 'null-live',
            label: 'one',
        });
        db.rows.add(row);
        await db.saveChanges();
        row.label = 'two';

        expect(updateSql(db)).not.toContain('"deleted_at"');
        await expect(db.saveChanges()).resolves.toBe(1);
        await db.dispose();
    });

    it('leaves an undefined live marker out of an attached update', async () => {
        const db = await open();
        await insertRaw(db, 'undefined-live', null);
        const row = Object.assign(new TransitionRow(), {
            id: 'undefined-live',
            label: 'one',
            deletedAt: undefined,
        });
        db.rows.attach(row);
        row.label = 'two';

        expect(updateSql(db)).not.toContain('"deleted_at"');
        await expect(db.saveChanges()).resolves.toBe(1);
        await db.dispose();
    });

    it('writes a marker when an undefined live value is removed', async () => {
        const db = await open();
        await insertRaw(db, 'undefined-delete', null);
        const row = Object.assign(new TransitionRow(), {
            id: 'undefined-delete',
            label: 'one',
            deletedAt: undefined,
        });
        db.rows.attach(row);
        db.rows.remove(row);

        expect(updateSql(db).match(/"deleted_at"/gu)).toHaveLength(1);
        await expect(db.saveChanges()).resolves.toBe(1);
        await db.dispose();
    });

    it('does not rewrite an existing deleted marker during business updates', async () => {
        const db = await open();
        const deletedAt = new Date('2026-08-10T12:00:00.000Z');
        await insertRaw(db, 'already-deleted', deletedAt.toISOString());
        const row = Object.assign(new TransitionRow(), {
            id: 'already-deleted',
            label: 'one',
            deletedAt,
        });
        db.rows.attach(row);
        row.label = 'two';

        expect(updateSql(db)).not.toContain('"deleted_at"');
        await expect(db.saveChanges()).resolves.toBe(1);
        await db.dispose();
    });

    it('writes one marker assignment for a real soft delete', async () => {
        const db = await open();
        const row = Object.assign(new TransitionRow(), {
            id: 'delete-once',
            label: 'one',
        });
        db.rows.add(row);
        await db.saveChanges();
        db.rows.remove(row);

        expect(updateSql(db).match(/"deleted_at"/gu)).toHaveLength(1);
        await db.dispose();
    });

    it('allows null assignments to ordinary nullable properties', async () => {
        const db = await open();
        const row: TransitionRow = Object.assign(new TransitionRow(), {
            id: 'nullable-business',
            label: 'one',
            note: 'present',
        });
        db.rows.add(row);
        await db.saveChanges();
        row.note = null;

        expect(updateSql(db)).toContain('"note" = ?');
        await expect(db.saveChanges()).resolves.toBe(1);
        await db.dispose();
    });
});
