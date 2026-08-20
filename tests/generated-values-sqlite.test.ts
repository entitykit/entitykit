import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { internalEntityEntry } from './support/public-api-internals';

class SqliteGeneratedRow {
    public id = 0;
    public label!: string;
    public createdAt!: Date;
    public payload!: { source: string };
}

class SqliteGeneratedContext extends DbContext {
    public rows = this.set(SqliteGeneratedRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(SqliteGeneratedRow, entity => {
            entity.toTable('generated_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id)
                .hasColumnName('id').hasColumnType('integer').isRequired()
                .useSqliteRowId({ preventReuse: true });
            entity.property(row => row.label)
                .hasColumnName('label').hasColumnType('text').isRequired();
            entity.property(row => row.createdAt)
                .hasColumnName('created_at').hasColumnType('timestamp').isRequired()
                .hasDefaultSql('current_timestamp')
                .valueGeneratedOnAdd();
            entity.property(row => row.payload).hasColumnType('json').isRequired()
                .hasDefaultSql('\'{"source":"database"}\'')
                .valueGeneratedOnAdd();
        });
    }
}

describe('SQLite database-generated values', () => {
    it('hydrates rowid and default values through returning', async () => {
        const db = SqliteGeneratedContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        const row = { label: 'sqlite' } as SqliteGeneratedRow;
        const entry = db.rows.add(row);

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(row.id).toBe(1);
        expect(row.createdAt).toBeInstanceOf(Date);
        expect(row.payload).toEqual({ source: 'database' });
        expect(internalEntityEntry(entry).originalBoundValues.payload)
            .toBe('{"source":"database"}');
        db.changeTracker.clear();
        await expect(db.rows.find(1)).resolves.toMatchObject({
            id: 1,
            label: 'sqlite',
        });
        await db.dispose();
    });

    it('uses AUTOINCREMENT only when rowid reuse prevention is requested', async () => {
        const db = SqliteGeneratedContext.create();
        expect(db.database.createScript()).toContain(
            '"id" integer primary key autoincrement',
        );
        await db.database.connection.query({ text: db.database.createScript(), values: [] });
        await db.database.connection.query({
            text: 'insert into generated_rows (label) values (?)',
            values: ['first'],
        });
        await db.database.connection.query({
            text: 'delete from generated_rows where id = 1',
            values: [],
        });
        const inserted = await db.database.connection.query<{ id: number }>({
            text: 'insert into generated_rows (label) values (?) returning id',
            values: ['second'],
        });

        expect(inserted.rows[0]?.id).toBe(2);
        await db.dispose();
    });

    it('rejects attaching an added generated-key instance', async () => {
        const db = await openWithZeroRow();
        const pending = Object.assign(new SqliteGeneratedRow(), {
            label: 'pending',
        });
        const entry = db.rows.add(pending);

        expect(() => db.rows.attach(pending)).toThrow(
            'already tracked as Added',
        );
        expect(entry.state).toBe(EntityState.Added);
        const stored = await db.rows.find(0);
        expect(stored).not.toBe(pending);
        expect(stored).toMatchObject({ id: 0, label: 'stored' });
        expect(db.changeTracker.entries()).toHaveLength(2);
        await db.dispose();
    });

    it('rejects manual acceptance of an unresolved generated identity', async () => {
        const db = await openWithZeroRow();
        const pending = Object.assign(new SqliteGeneratedRow(), {
            label: 'pending',
        });
        const entry = db.rows.add(pending);

        expect(() => {
            db.changeTracker.acceptAllChanges();
        }).toThrow(
            'acceptAllChanges() cannot accept Added entries because they have no persisted baseline.',
        );
        expect(entry.state).toBe(EntityState.Added);
        await expect(db.rows.find(0)).resolves.toMatchObject({
            id: 0,
            label: 'stored',
        });
        expect(db.changeTracker.entries()).toHaveLength(2);
        await db.dispose();
    });
});

async function openWithZeroRow(): Promise<SqliteGeneratedContext> {
    const db = SqliteGeneratedContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    await db.database.connection.query({
        text: `insert into generated_rows (id, label, created_at)
            values (?, ?, current_timestamp)`,
        values: [0, 'stored'],
    });
    return db;
}
