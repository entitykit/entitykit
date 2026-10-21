import { DbContext, EntityState, type ModelBuilder } from '../packages/core/src';
import { createSqliteDataSource } from '../packages/sqlite/src';
import { internalEntityEntry } from './support/public-api-internals';

class SpecialRow {
    public id = 'one';
    public ['__proto__'] = 'original';
}

class GeneratedSpecialRow {
    public ['__proto__'] = 0;
    public label = 'generated';
}

class SpecialContext extends DbContext {
    public readonly rows = this.set(SpecialRow);
    public readonly generated = this.set(GeneratedSpecialRow);

    protected override model(model: ModelBuilder): void {
        model.entity(SpecialRow, entity => {
            entity.toTable('special_rows').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.__proto__).hasColumnType('text').isRequired();
        });
        model.entity(GeneratedSpecialRow, entity => {
            entity.toTable('generated_rows').hasKey(row => row.__proto__);
            entity.property(row => row.__proto__).hasColumnType('integer')
                .isRequired().useSqliteRowId({ preventReuse: true });
            entity.property(row => row.label).hasColumnType('text').isRequired();
        });
    }
}

async function withDatabase(action: (db: SpecialContext) => Promise<void>): Promise<void> {
    const source = createSqliteDataSource(':memory:');
    try {
        await using db = source.createContext(SpecialContext);
        await db.database.connection.query({ text: db.database.createScript(), values: [] });
        await db.database.connection.query({
            text: 'insert into special_rows (id, "__proto__") values (?, ?)',
            values: ['one', 'original'],
        });
        await action(db);
    } finally {
        await source.dispose();
    }
}

describe('mapped special-key SQLite lifecycle', () => {
    it('reads, edits, saves and accepts a tracked special property', async () => {
        await withDatabase(async db => {
            const row = await db.rows.findOrThrow('one');
            expect(row.__proto__).toBe('original');
            expect(Object.getPrototypeOf(row)).toBe(SpecialRow.prototype);
            await expect(db.saveChanges()).resolves.toBe(0);
            row.__proto__ = 'changed';
            await expect(db.saveChanges()).resolves.toBe(1);
            await expect(db.saveChanges()).resolves.toBe(0);
            expect(db.entry(row)?.state).toBe(EntityState.Unchanged);
            db.clearTracking();
            const stored = await db.rows.findOrThrow('one');
            expect(stored.__proto__).toBe('changed');
        });
    });

    it('attaches an untracked materialization and saves later special-key changes', async () => {
        await withDatabase(async db => {
            const row = await db.rows.asNoTracking().first();
            expect(row.__proto__).toBe('original');
            const entry = db.rows.attach(row);
            expect(internalEntityEntry(entry).originalValues.__proto__).toBe('original');
            row.__proto__ = 'changed';
            await expect(db.saveChanges()).resolves.toBe(1);
            expect(internalEntityEntry(entry).originalValues.__proto__).toBe('changed');
            expect(internalEntityEntry(entry).originalBoundValues.__proto__).toBe('changed');
        });
    });

    it('inserts and manually accepts own special-key values', async () => {
        await withDatabase(async db => {
            const row = new SpecialRow();
            row.id = 'two';
            row.__proto__ = 'inserted';
            const entry = db.rows.add(row);
            await expect(db.saveChanges()).resolves.toBe(1);
            const stored = await db.rows.asNoTracking().where(x => x.id.eq('two')).first();
            expect(stored.__proto__).toBe('inserted');
            row.__proto__ = 'accepted';
            db.changeTracker.acceptAllChanges();
            expect(internalEntityEntry(entry).originalValues.__proto__).toBe('accepted');
            expect(internalEntityEntry(entry).originalBoundValues.__proto__).toBe('accepted');
            await expect(db.saveChanges()).resolves.toBe(0);
        });
    });

    it('accepts a generated special primary key and resolves it from the identity map', async () => {
        await withDatabase(async db => {
            const row = new GeneratedSpecialRow();
            const entry = db.generated.add(row);
            await expect(db.saveChanges()).resolves.toBe(1);
            expect(row.__proto__).toBe(1);
            expect(Object.getPrototypeOf(row)).toBe(GeneratedSpecialRow.prototype);
            expect(internalEntityEntry(entry).originalBoundValues.__proto__).toBe(1);
            await expect(db.generated.find(1)).resolves.toBe(row);
            row.label = 'updated';
            await expect(db.saveChanges()).resolves.toBe(1);
            db.clearTracking();
            const stored = await db.generated.findOrThrow(1);
            expect(stored.__proto__).toBe(1);
            expect(stored.label).toBe('updated');
        });
    });

    it('restores generated special keys after a failed save and permits retry', async () => {
        await withDatabase(async db => {
            await db.database.connection.query({
                text: 'create unique index unique_label on generated_rows (label)', values: [],
            });
            const first = new GeneratedSpecialRow();
            const second = new GeneratedSpecialRow();
            db.generated.add(first);
            db.generated.add(second);
            await expect(db.saveChanges()).rejects.toThrow();
            expect(first.__proto__).toBe(0);
            expect(second.__proto__).toBe(0);
            expect(Object.getPrototypeOf(first)).toBe(GeneratedSpecialRow.prototype);
            expect(Object.getPrototypeOf(second)).toBe(GeneratedSpecialRow.prototype);
            await expect(db.generated.count()).resolves.toBe(0);
            second.label = 'second';
            await expect(db.saveChanges()).resolves.toBe(2);
            expect(first.__proto__).toBe(1);
            expect(second.__proto__).toBe(2);
        });
    });
});
