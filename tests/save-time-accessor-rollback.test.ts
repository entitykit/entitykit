import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    SaveChangesInterceptor,
} from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

const originalTime = new Date('2026-01-01T00:00:00.000Z');
const saveTime = new Date('2026-08-05T12:00:00.000Z');

class AccessorPolicyRow {
    #updatedAtMs = 0;
    #deletedAtMs: number | null = null;

    public id = '';
    public slug = '';
    public name = '';

    public get updatedAt(): Date {
        return new Date(this.#updatedAtMs);
    }

    public set updatedAt(value: Date) {
        this.#updatedAtMs = value.getTime();
    }

    public get deletedAt(): Date | null {
        return this.#deletedAtMs === null
            ? null
            : new Date(this.#deletedAtMs);
    }

    public set deletedAt(value: Date | null) {
        this.#deletedAtMs = value?.getTime() ?? null;
    }
}

class AccessorPolicyContext extends DbContext {
    public rows = this.set(AccessorPolicyRow);

    constructor(
        private readonly interceptors: readonly SaveChangesInterceptor[] = [],
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useAuditing({ now: () => saveTime });
        for (const interceptor of this.interceptors) {
            options.useSaveInterceptor(interceptor);
        }
    }

    protected override model(model: ModelBuilder): void {
        model.entity(AccessorPolicyRow, entity => {
            entity.toTable('accessor_policy_rows');
            entity.hasKey(row => row.id);
            entity.hasIndex(row => row.slug).isUnique();
            entity.audit({ updatedAt: row => row.updatedAt });
            entity.softDelete(row => row.deletedAt);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.slug).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.property(row => row.updatedAt).hasColumnName('updated_at')
                .hasColumnType('timestamp').isRequired();
            entity.property(row => row.deletedAt).hasColumnName('deleted_at')
                .hasColumnType('timestamp');
        });
    }
}

async function open(
    ...interceptors: readonly SaveChangesInterceptor[]
): Promise<AccessorPolicyContext> {
    const db = AccessorPolicyContext.create(interceptors);
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    await db.database.connection.query({
        text: `insert into accessor_policy_rows
            (id, slug, name, updated_at, deleted_at)
            values (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
        values: [
            'row-1', 'one', 'one', originalTime, null,
            'row-2', 'two', 'two', originalTime, null,
        ],
    });
    return db;
}

describe('save-time accessor rollback', () => {
    it('restores an audit accessor after plan inspection', async () => {
        const db = await open();
        const row = requireDefined(await db.rows.find('row-1'));
        row.name = 'changed';

        expect(db.getSavePlan()).toHaveLength(1);

        expect(row.updatedAt).toEqual(originalTime);
        expect(db.entry(row)?.modifiedProperties()).toEqual(['name']);
        await db.dispose();
    });

    it('restores a soft-delete accessor after plan inspection', async () => {
        const db = await open();
        const row = requireDefined(await db.rows.find('row-1'));
        const entry = db.rows.remove(row);

        expect(db.getSavePlan()).toHaveLength(1);

        expect(row.deletedAt).toBeNull();
        expect(entry.state).toBe(EntityState.Deleted);
        await db.dispose();
    });

    it('restores an audit accessor after provider failure', async () => {
        const db = await open();
        const row = requireDefined(await db.rows.find('row-1'));
        row.name = 'changed';
        row.slug = 'two';

        await expect(db.saveChanges()).rejects.toThrow(/unique/i);

        expect(row.updatedAt).toEqual(originalTime);
        expect(db.entry(row)?.state).toBe(EntityState.Modified);
        expect(db.entry(row)?.modifiedProperties()).toEqual(['slug', 'name']);
        await db.dispose();
    });

    it('preserves an application overwrite after the provisional value', async () => {
        const applicationTime = new Date('2030-01-01T00:00:00.000Z');
        const db = await open({
            savingChanges: () => {
                row.updatedAt = applicationTime;
                throw new Error('stop after application write');
            },
        });
        const row = requireDefined(await db.rows.find('row-1'));
        row.name = 'changed';

        await expect(db.saveChanges()).rejects.toThrow(
            'stop after application write',
        );

        expect(row.updatedAt).toEqual(applicationTime);
        expect(db.entry(row)?.modifiedProperties()).toEqual([
            'updatedAt',
            'name',
        ]);
        await db.dispose();
    });
});
