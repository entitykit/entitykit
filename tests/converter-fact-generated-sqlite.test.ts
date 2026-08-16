import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { ContextStateRestorationError, DbContext, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';
import { refusalMessage, rejection } from './support/accessor-refusal-support';
import {
    HiddenKey,
    StrongId,
    StrongKey,
    hiddenKeyConverter,
    interceptProperty,
    strongIdConverter,
    strongKeyConverter,
} from './support/converter-fact-support';

class GeneratedStrongRow {
    public id = new StrongKey(0);
    public label = '';
}

class GeneratedHiddenRow {
    public id = new HiddenKey(0);
    public label = '';
}

class GeneratedTokenRow {
    public id = '';
    public token = new StrongId('');
}

class GeneratedPrincipal {
    public id = new StrongKey(0);
    public children: GeneratedDependent[] = [];
}

class GeneratedDependent {
    public id = '';
    public parentId = new StrongKey(0);
    public parent: GeneratedPrincipal | null = null;
}

class GeneratedFactContext extends DbContext {
    public strongRows = this.set(GeneratedStrongRow);
    public hiddenRows = this.set(GeneratedHiddenRow);
    public tokenRows = this.set(GeneratedTokenRow);
    public principals = this.set(GeneratedPrincipal);
    public dependents = this.set(GeneratedDependent);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedStrongRow, entity => {
            entity.toTable('generated_strong_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .hasConversion(strongKeyConverter).isRequired().useSqliteRowId();
            entity.property(row => row.label).hasColumnType('text').isRequired();
        });
        model.entity(GeneratedHiddenRow, entity => {
            entity.toTable('generated_hidden_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .hasConversion(hiddenKeyConverter).isRequired().useSqliteRowId();
            entity.property(row => row.label).hasColumnType('text').isRequired();
        });
        model.entity(GeneratedTokenRow, entity => {
            entity.toTable('generated_token_rows');
            entity.hasKey(row => row.id);
            entity.hasAlternateKey(row => row.token);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.token).hasColumnType('text')
                .hasConversion(strongIdConverter).isRequired()
                .hasDefaultSql('\'ak-1\'').valueGeneratedOnAdd();
        });
        model.entity(GeneratedPrincipal, entity => {
            entity.toTable('generated_principals');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .hasConversion(strongKeyConverter).isRequired().useSqliteRowId();
        });
        model.entity(GeneratedDependent, entity => {
            entity.toTable('generated_dependents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').hasConversion(strongKeyConverter)
                .isRequired();
            entity.hasOne(GeneratedPrincipal, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
    }
}

async function open(): Promise<GeneratedFactContext> {
    const db = GeneratedFactContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    return db;
}

async function storedRows(
    db: GeneratedFactContext,
    text: string,
): Promise<ReadonlyArray<Record<string, unknown>>> {
    const result = await db.database.connection.query({ text, values: [] });
    return result.rows;
}

describe('converter-aware verified writes of database-generated values', () => {
    it('fails a save whose private-field key setter stores another key', async () => {
        const db = await open();
        const row = Object.assign(new GeneratedStrongRow(), { label: 'a' });
        db.strongRows.add(row);
        interceptProperty<StrongKey>(row, 'id', value =>
            value.value === 1 ? new StrongKey(999) : value);

        const failure = await rejection(async () => db.saveChanges());

        expect(refusalMessage(failure)).toBe(
            'Property \'GeneratedStrongRow.id\' refused its assigned value.',
        );
        expect(row.id).toBeInstanceOf(StrongKey);
        expect(row.id.value).toBe(0);
        expect(requireDefined(db.entry(row)).state).toBe(EntityState.Added);
        await expect(storedRows(
            db, 'select id from generated_strong_rows',
        )).resolves.toEqual([]);
        await expect(db.strongRows.count()).resolves.toBe(0);
        await db.dispose();
    });

    it('fails a save whose generated alternate key setter substitutes a value', async () => {
        const db = await open();
        const row = Object.assign(new GeneratedTokenRow(), { id: 't1' });
        db.tokenRows.add(row);
        interceptProperty<StrongId>(row, 'token', value =>
            value.value === 'ak-1' ? new StrongId('WRONG') : value);

        const failure = await rejection(async () => db.saveChanges());

        expect(refusalMessage(failure)).toBe(
            'Property \'GeneratedTokenRow.token\' refused its assigned value.',
        );
        expect(row.token).toBeInstanceOf(StrongId);
        expect(row.token.value).toBe('');
        expect(requireDefined(db.entry(row)).state).toBe(EntityState.Added);
        await expect(storedRows(
            db, 'select id, token from generated_token_rows',
        )).resolves.toEqual([]);
        await db.dispose();
    });

    it('fails a save whose propagated foreign key setter retains its own value', async () => {
        const db = await open();
        const parent = new GeneratedPrincipal();
        const child = Object.assign(new GeneratedDependent(), { id: 'c1' });
        child.parent = parent;
        db.principals.add(parent);
        db.dependents.add(child);
        interceptProperty<StrongKey>(child, 'parentId', value =>
            value.value === 1 ? new StrongKey(999) : value);

        const failure = await rejection(async () => db.saveChanges());

        expect(refusalMessage(failure)).toBe(
            'Property \'GeneratedDependent.parentId\' refused its assigned value.',
        );
        expect(child.parentId).toBeInstanceOf(StrongKey);
        expect(child.parentId.value).toBe(0);
        expect(parent.id.value).toBe(0);
        await expect(storedRows(
            db, 'select id from generated_principals',
        )).resolves.toEqual([]);
        await expect(storedRows(
            db, 'select id, parent_id from generated_dependents',
        )).resolves.toEqual([]);
        await expect(db.principals.count()).resolves.toBe(0);
        await db.dispose();
    });

    it('fails a save whose generated key setter stores an empty value object', async () => {
        const db = await open();
        const row = Object.assign(new GeneratedHiddenRow(), { label: 'a' });
        db.hiddenRows.add(row);
        // Structurally indistinguishable from the generated key: same
        // prototype, zero enumerable own keys, no state at all.
        interceptProperty<HiddenKey>(row, 'id', value =>
            value.number === 1
                ? Object.create(HiddenKey.prototype) as HiddenKey
                : value);

        const failure = await rejection(async () => db.saveChanges());

        expect(refusalMessage(failure)).toBe(
            'Property \'GeneratedHiddenRow.id\' refused its assigned value.',
        );
        expect(row.id).toBeInstanceOf(HiddenKey);
        expect(row.id.number).toBe(0);
        await expect(storedRows(
            db, 'select id from generated_hidden_rows',
        )).resolves.toEqual([]);
        await db.dispose();
    });

    it('restores a valid model key and keeps the context usable', async () => {
        const db = await open();
        const row = Object.assign(new GeneratedStrongRow(), { label: 'a' });
        db.strongRows.add(row);
        let refuse = true;
        interceptProperty<StrongKey>(row, 'id', value =>
            refuse && value.value === 1 ? new StrongKey(999) : value);

        await rejection(async () => db.saveChanges());
        refuse = false;

        expect(row.id).toBeInstanceOf(StrongKey);
        expect(row.id.value).toBe(0);
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(row.id.value).toBe(1);
        await expect(storedRows(
            db, 'select id, label from generated_strong_rows',
        )).resolves.toEqual([{ id: 1, label: 'a' }]);
        expect(requireDefined(db.entry(row)).state).toBe(EntityState.Unchanged);
        await db.dispose();
    });

    it('poisons the context when the key restoration is refused too', async () => {
        const db = await open();
        const row = Object.assign(new GeneratedStrongRow(), { label: 'a' });
        db.strongRows.add(row);
        interceptProperty<StrongKey>(row, 'id', () => new StrongKey(999));

        const failure = await rejection(async () => db.saveChanges());

        expect(refusalMessage(failure)).toBe(
            'Property \'GeneratedStrongRow.id\' refused its assigned value.',
        );
        expect(row.id.value).toBe(999);
        const poison = await rejection(async () => db.strongRows.count());
        expect(poison).toBeInstanceOf(ContextStateRestorationError);
        expect(poison).not.toBe(failure);
        expect(refusalMessage((poison as Error).cause)).toBe(
            'Property \'GeneratedStrongRow.id\' refused its restoration value.',
        );
        await db.dispose();
    });
});
