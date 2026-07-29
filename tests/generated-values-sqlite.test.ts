import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class SqliteGeneratedRow {
    public id!: number;
    public label!: string;
    public createdAt!: Date;
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
        db.rows.add(row);

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(row.id).toBe(1);
        expect(row.createdAt).toBeInstanceOf(Date);
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
});
