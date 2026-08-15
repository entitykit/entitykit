import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';
import { refusalMessage, rejection } from './support/accessor-refusal-support';

const saveTime = new Date('2026-08-15T12:00:00.000Z');
const oldTime = new Date('2026-01-01T00:00:00.000Z');

let refuseGeneratedKey = true;

class GeneratedKeyRow {
    private storedId = 0;
    public sku = '';
    public createdAt?: Date;

    public get id(): number {
        return this.storedId;
    }

    public set id(value: number) {
        if (refuseGeneratedKey && value !== 0) return;
        this.storedId = value;
    }
}

class AuditedRefusalRow {
    private storedStamp: Date | null = null;
    public id = '';
    public name = '';
    public refuseStamp = false;

    public get updatedAt(): Date | null {
        return this.storedStamp;
    }

    public set updatedAt(value: Date | null) {
        if (this.refuseStamp && value?.getTime() === saveTime.getTime()) return;
        this.storedStamp = value;
    }
}

class SaveRefusalContext extends DbContext {
    public generated = this.set(GeneratedKeyRow);
    public audited = this.set(AuditedRefusalRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useAuditing({ now: () => saveTime });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedKeyRow, entity => {
            entity.toTable('generated_key_rows');
            entity.hasKey(row => row.id);
            entity.audit({ createdAt: row => row.createdAt });
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(row => row.sku).hasColumnType('text').isRequired();
            entity.property(row => row.createdAt).hasColumnName('created_at')
                .hasColumnType('timestamp').isOptional();
        });
        model.entity(AuditedRefusalRow, entity => {
            entity.toTable('audited_refusal_rows');
            entity.hasKey(row => row.id);
            entity.audit({ updatedAt: row => row.updatedAt });
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.property(row => row.updatedAt).hasColumnName('updated_at')
                .hasColumnType('timestamp').isOptional();
        });
    }
}

async function open(): Promise<SaveRefusalContext> {
    const db = SaveRefusalContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: `insert into audited_refusal_rows (id, name, updated_at)
            values (?, ?, ?), (?, ?, ?)`,
        values: [
            'r1', 'one', oldTime.toISOString(),
            'r2', 'two', oldTime.toISOString(),
        ],
    });
    return db;
}

async function storedGeneratedRows(
    db: SaveRefusalContext,
): Promise<ReadonlyArray<Record<string, unknown>>> {
    const result = await db.database.connection.query({
        text: 'select id, sku, created_at from generated_key_rows', values: [],
    });
    return result.rows;
}

describe('accessor refusal during saveChanges', () => {
    beforeEach(() => {
        refuseGeneratedKey = true;
    });

    it('fails a save whose entity refuses the database-generated key', async () => {
        const db = await open();
        const row = Object.assign(new GeneratedKeyRow(), { sku: 'sku-1' });
        db.generated.add(row);

        const failure = await rejection(async () => db.saveChanges());

        expect(refusalMessage(failure)).toBe(
            'Property \'GeneratedKeyRow.id\' refused its assigned value.',
        );
        expect(row.id).toBe(0);
        expect(row.createdAt).toBeUndefined();
        const entry = requireDefined(db.entry(row));
        expect(entry.state).toBe(EntityState.Added);
        expect(entry.keyValue).toBe(0);
        await expect(storedGeneratedRows(db)).resolves.toEqual([]);
        refuseGeneratedKey = false;
        await db.database.connection.query({
            text: `insert into generated_key_rows (id, sku, created_at)
                values (?, ?, ?)`,
            values: [1, 'unrelated', oldTime.toISOString()],
        });
        const resolved = requireDefined(await db.generated.find(1));
        expect(resolved).not.toBe(row);
        expect(resolved.sku).toBe('unrelated');
        await db.dispose();
    });

    it('fails a save whose audited entity refuses its save-time stamp', async () => {
        const db = await open();
        const first = requireDefined(await db.audited.find('r1'));
        const second = requireDefined(await db.audited.find('r2'));
        first.name = 'changed-one';
        second.name = 'changed-two';
        second.refuseStamp = true;

        const failure = await rejection(async () => db.saveChanges());

        expect(refusalMessage(failure)).toBe(
            'Property \'AuditedRefusalRow.updatedAt\' refused its assigned value.',
        );
        expect(first.updatedAt).toEqual(oldTime);
        expect(second.updatedAt).toEqual(oldTime);
        for (const row of [first, second]) {
            const entry = requireDefined(db.entry(row));
            expect(entry.state).toBe(EntityState.Modified);
            expect(entry.modifiedProperties()).toEqual(['name']);
            expect(entry.originalValues).toMatchObject({ updatedAt: oldTime });
        }
        db.changeTracker.clear();
        const fresh = requireDefined(await db.audited.find('r2'));
        expect(fresh).not.toBe(second);
        expect(fresh.name).toBe('two');
        expect(fresh.updatedAt).toEqual(oldTime);
        await db.dispose();
    });
});
