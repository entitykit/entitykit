import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState, valueConverter } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class ActorId {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    public get value(): string {
        return this.#value;
    }
}

const actorId = valueConverter<ActorId, string>({
    toProvider: value => value.value,
    fromProvider: value => new ActorId(value),
});

class AuditStamp {
    #updatedBy = '';

    public get updatedBy(): ActorId {
        return new ActorId(this.#updatedBy);
    }

    public set updatedBy(value: ActorId) {
        this.#updatedBy = value.value;
    }
}

class ComplexAuditRow {
    public id = '';
    public slug = '';
    public name = '';
    public audit = new AuditStamp();
}

class ComplexAuditContext extends DbContext {
    public rows = this.set(ComplexAuditRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useAuditing({
                currentUserId: () => new ActorId('current-user'),
            });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ComplexAuditRow, entity => {
            entity.toTable('complex_audit_rows');
            entity.hasKey(row => row.id);
            entity.hasIndex(row => row.slug).isUnique();
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.slug).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.audit({ updatedBy: row => row.audit.updatedBy });
            entity.complexProperty(
                row => row.audit,
                { constructor: AuditStamp, required: true },
                audit => {
                    audit.property(value => value.updatedBy)
                        .hasColumnName('updated_by').hasColumnType('text')
                        .hasConversion(actorId).isRequired();
                },
            );
        });
    }
}

async function open(): Promise<ComplexAuditContext> {
    const db = ComplexAuditContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    await db.database.connection.query({
        text: `insert into complex_audit_rows
            (id, slug, name, updated_by) values (?, ?, ?, ?), (?, ?, ?, ?)`,
        values: [
            'row-1', 'one', 'first', 'original-user',
            'row-2', 'two', 'second', 'original-user',
        ],
    });
    return db;
}

describe('complex converted save-time rollback', () => {
    it('restores a converted nested audit accessor after plan inspection', async () => {
        const db = await open();
        const row = requireDefined(await db.rows.find('row-1'));
        row.name = 'changed';

        expect(db.getSavePlan()).toHaveLength(1);

        expect(row.audit.updatedBy.value).toBe('original-user');
        expect(db.entry(row)?.modifiedProperties()).toEqual(['name']);
        await db.dispose();
    });

    it('restores a converted nested audit accessor after provider failure', async () => {
        const db = await open();
        const row = requireDefined(await db.rows.find('row-1'));
        row.name = 'changed';
        row.slug = 'two';

        await expect(db.saveChanges()).rejects.toThrow(/unique/i);

        expect(row.audit.updatedBy.value).toBe('original-user');
        expect(db.entry(row)?.state).toBe(EntityState.Modified);
        expect(db.entry(row)?.modifiedProperties()).toEqual(['slug', 'name']);
        await db.dispose();
    });
});
