import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState, valueConverter } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';
import { refusalMessage, rejection } from './support/accessor-refusal-support';
import {
    HiddenId,
    StrongId,
    hiddenIdConverter,
    interceptProperty,
    strongIdConverter,
    trimmedTextConverter,
} from './support/converter-fact-support';

const saveTime = new Date('2026-08-15T12:00:00.000Z');
let auditUser: unknown;

/** A mutable converted model value, so an accessor can mutate it in place. */
const partsConverter = valueConverter<{ parts: string[] }, string>({
    toProvider: value => value.parts.join('|'),
    fromProvider: value => ({ parts: value.split('|') }),
});

class StrongAuditRow {
    public id = '';
    public updatedBy = new StrongId('seed');
}

class HiddenAuditRow {
    public id = '';
    public updatedBy = new HiddenId('seed');
}

class PartsAuditRow {
    public id = '';
    public updatedBy: { parts: string[] } = { parts: ['seed'] };
}

class TrimAuditRow {
    public id = '';
    public updatedBy = 'seed';
}

class AssignmentFactContext extends DbContext {
    public strong = this.set(StrongAuditRow);
    public hidden = this.set(HiddenAuditRow);
    public parts = this.set(PartsAuditRow);
    public trimmed = this.set(TrimAuditRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useAuditing({
                now: () => saveTime, currentUserId: () => auditUser,
            });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(StrongAuditRow, entity => {
            entity.toTable('strong_audit_rows');
            entity.hasKey(row => row.id);
            entity.audit({ updatedBy: row => row.updatedBy });
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.updatedBy).hasColumnName('updated_by')
                .hasColumnType('text').hasConversion(strongIdConverter)
                .isRequired();
        });
        model.entity(HiddenAuditRow, entity => {
            entity.toTable('hidden_audit_rows');
            entity.hasKey(row => row.id);
            entity.audit({ updatedBy: row => row.updatedBy });
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.updatedBy).hasColumnName('updated_by')
                .hasColumnType('text').hasConversion(hiddenIdConverter)
                .isRequired();
        });
        model.entity(PartsAuditRow, entity => {
            entity.toTable('parts_audit_rows');
            entity.hasKey(row => row.id);
            entity.audit({ updatedBy: row => row.updatedBy });
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.updatedBy).hasColumnName('updated_by')
                .hasColumnType('text').hasConversion(partsConverter)
                .isRequired();
        });
        model.entity(TrimAuditRow, entity => {
            entity.toTable('trim_audit_rows');
            entity.hasKey(row => row.id);
            entity.audit({ updatedBy: row => row.updatedBy });
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.updatedBy).hasColumnName('updated_by')
                .hasColumnType('text').hasConversion(trimmedTextConverter)
                .isRequired();
        });
    }
}

async function open(): Promise<AssignmentFactContext> {
    const db = AssignmentFactContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    return db;
}

async function storedRows(
    db: AssignmentFactContext,
    table: string,
): Promise<ReadonlyArray<Record<string, unknown>>> {
    const result = await db.database.connection.query({
        text: `select id, updated_by from ${table}`, values: [],
    });
    return result.rows;
}

describe('converter-aware verified assignment through saveChanges', () => {
    beforeEach(() => {
        auditUser = undefined;
    });

    it('refuses a private-field identifier swapped for a different one', async () => {
        const db = await open();
        auditUser = new StrongId('u1');
        const row = Object.assign(new StrongAuditRow(), { id: 'r1' });
        db.strong.add(row);
        interceptProperty<StrongId>(row, 'updatedBy', value =>
            value.value === 'u1' ? new StrongId('WRONG') : value);

        const failure = await rejection(async () => db.saveChanges());

        expect(refusalMessage(failure)).toBe(
            'Property \'StrongAuditRow.updatedBy\' refused its assigned value.',
        );
        expect(row.updatedBy.value).toBe('seed');
        expect(requireDefined(db.entry(row)).state).toBe(EntityState.Added);
        await expect(storedRows(db, 'strong_audit_rows')).resolves.toEqual([]);
        await expect(db.strong.count()).resolves.toBe(0);
        await db.dispose();
    });

    it('refuses a non-enumerable value object holding a different value', async () => {
        const db = await open();
        auditUser = new HiddenId('u1');
        const row = Object.assign(new HiddenAuditRow(), { id: 'r1' });
        db.hidden.add(row);
        interceptProperty<HiddenId>(row, 'updatedBy', value =>
            value.text === 'u1' ? new HiddenId('WRONG') : value);

        const failure = await rejection(async () => db.saveChanges());

        expect(refusalMessage(failure)).toBe(
            'Property \'HiddenAuditRow.updatedBy\' refused its assigned value.',
        );
        expect(row.updatedBy.text).toBe('seed');
        expect(requireDefined(db.entry(row)).state).toBe(EntityState.Added);
        await expect(storedRows(db, 'hidden_audit_rows')).resolves.toEqual([]);
        await db.dispose();
    });

    it('refuses an accessor that mutates the converted object in place', async () => {
        const db = await open();
        auditUser = { parts: ['u1'] };
        const row = Object.assign(new PartsAuditRow(), { id: 'r1' });
        db.parts.add(row);
        let mutateOnce = true;
        interceptProperty<{ parts: string[] }>(row, 'updatedBy', value => {
            if (mutateOnce) {
                mutateOnce = false;
                value.parts.push('extra');
            }
            return value;
        });

        const failure = await rejection(async () => db.saveChanges());

        expect(refusalMessage(failure)).toBe(
            'Property \'PartsAuditRow.updatedBy\' refused its assigned value.',
        );
        expect(row.updatedBy).toEqual({ parts: ['seed'] });
        expect(requireDefined(db.entry(row)).state).toBe(EntityState.Added);
        await expect(storedRows(db, 'parts_audit_rows')).resolves.toEqual([]);
        await db.dispose();
    });

    it('accepts a normalizing accessor that preserves the provider fact', async () => {
        const db = await open();
        auditUser = 'ada';
        const row = Object.assign(new TrimAuditRow(), { id: 'r1' });
        db.trimmed.add(row);
        interceptProperty<string>(row, 'updatedBy', value => ` ${value} `);

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(row.updatedBy).toBe(' ada ');
        await expect(storedRows(db, 'trim_audit_rows')).resolves.toEqual([
            { id: 'r1', updated_by: 'ada' },
        ]);
        const entry = requireDefined(db.entry(row));
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(entry.originalValues).toEqual({ id: 'r1', updatedBy: 'ada' });
        await db.dispose();
    });

    it('surfaces a converter that throws while verifying the stored value', async () => {
        const db = await open();
        auditUser = new StrongId('u1');
        const row = Object.assign(new StrongAuditRow(), { id: 'r1' });
        db.strong.add(row);
        interceptProperty<StrongId>(row, 'updatedBy', value =>
            value.value === 'u1' ? ({} as StrongId) : value);

        const failure = await rejection(async () => db.saveChanges());

        expect(failure).toBeInstanceOf(TypeError);
        expect(refusalMessage(failure)).toBe('unconvertible strong identifier');
        expect(row.updatedBy).toBeInstanceOf(StrongId);
        expect(row.updatedBy.value).toBe('seed');
        expect(requireDefined(db.entry(row)).state).toBe(EntityState.Added);
        await expect(storedRows(db, 'strong_audit_rows')).resolves.toEqual([]);
        await expect(db.strong.count()).resolves.toBe(0);
        await db.dispose();
    });
});
