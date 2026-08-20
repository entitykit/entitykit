import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    PropertyBuilder,
} from '../packages/core/src';
import { DbContext, EntityState, valueConverter } from '../packages/core/src';
import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import { sqliteProviderServices } from '../packages/sqlite/src';

class SoftDeleteModelRow {
    public id = '';
    public marker: string | null = null;
}

function softDeleteModel(
    configure: (property: PropertyBuilder<string | null>) => void,
    deletedValue: unknown = 'deleted',
): ModelBuilderImplementation {
    return new ModelBuilderImplementation().entity(
        SoftDeleteModelRow,
        entity => {
            entity.toTable('soft_delete_model_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            configure(entity.property(row => row.marker).hasColumnType('text'));
            entity.softDelete(row => row.marker, deletedValue as string);
        },
    );
}

class GeneratedAddSoftRow {
    public id = '';
    public label = '';
    public deletedAt: Date | null = null;
}

class GeneratedAddSoftContext extends DbContext {
    public rows = this.set(GeneratedAddSoftRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedAddSoftRow, entity => {
            entity.toTable('generated_add_soft_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.deletedAt).hasColumnName('deleted_at')
                .hasColumnType('timestamp').hasDefaultSql('  NULL  ')
                .valueGeneratedOnAdd();
            entity.softDelete(row => row.deletedAt);
        });
    }
}

const runtimeNullConverter = valueConverter<Date, string | null>({
    toProvider: () => null,
    fromProvider: value => value === null ? new Date(0) : new Date(value),
});

class RuntimeNullSoftRow {
    public id = '';
    public label = '';
    public deletedAt: Date | null = null;
}

class RuntimeNullSoftContext extends DbContext {
    public rows = this.set(RuntimeNullSoftRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(RuntimeNullSoftRow, entity => {
            entity.toTable('runtime_null_soft_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.deletedAt).hasColumnName('deleted_at')
                .hasColumnType('text').hasConversion(runtimeNullConverter);
            entity.softDelete(row => row.deletedAt);
        });
    }
}

let collapseDuringBinding = false;
const lateNullConverter = valueConverter<Date, string | null>({
    toProvider: value => collapseDuringBinding ? null : value.toISOString(),
    fromProvider: value => {
        collapseDuringBinding = true;
        return new Date(value ?? 0);
    },
});

class LateNullSoftContext extends DbContext {
    public rows = this.set(RuntimeNullSoftRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(RuntimeNullSoftRow, entity => {
            entity.toTable('late_null_soft_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.deletedAt).hasColumnName('deleted_at')
                .hasColumnType('text').hasConversion(lateNullConverter);
            entity.softDelete(row => row.deletedAt);
        });
    }
}

async function createSchema(db: DbContext): Promise<void> {
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
}

describe('soft-delete model safety', () => {
    it('rejects an explicit null deleted value', () => {
        expect(() => softDeleteModel(() => undefined, null).build()).toThrow(
            'must write a non-null provider value, because SQL NULL represents a live row',
        );
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
    ] as const)('rejects a deleted value whose converter produces %s', (_label, providerValue) => {
        const converter = valueConverter<string, string | null | undefined>({
            toProvider: () => providerValue,
            fromProvider: value => value ?? 'live',
        });

        expect(() => softDeleteModel(property => {
            property.hasConversion(converter);
        }, 'deleted').build()).toThrow(
            'must write a non-null provider value, because SQL NULL represents a live row',
        );
    });

    it.each([
        ['generated on update', (property: PropertyBuilder<string | null>) =>
            property.valueGeneratedOnAddOrUpdate()],
        ['computed', (property: PropertyBuilder<string | null>) =>
            property.hasComputedColumnSql('null')],
    ] as const)('rejects a marker that is %s', (_label, configure) => {
        expect(() => softDeleteModel(configure).build()).toThrow(
            'cannot be computed or generated on update, because remove() must write its deleted marker',
        );
    });

    it.each([
        ['a non-null SQL default', (property: PropertyBuilder<string | null>) =>
            property.hasDefaultSql('current_timestamp').valueGeneratedOnAdd()],
        ['a non-null value default', (property: PropertyBuilder<string | null>) =>
            property.hasDefaultValue('deleted').valueGeneratedOnAdd()],
        ['store generation', (property: PropertyBuilder<string | null>) =>
            property.useSequence('soft_delete_sequence').isOptional()],
    ] as const)('rejects a generated-on-add marker with %s', (_label, configure) => {
        expect(() => softDeleteModel(configure).build()).toThrow(
            'can be generated on add only when its database live-row default is SQL NULL',
        );
    });

    it.each([
        ['no database default', (property: PropertyBuilder<string | null>) =>
            property.valueGeneratedOnAdd()],
        ['a null value default', (property: PropertyBuilder<string | null>) =>
            property.hasDefaultValue(null).valueGeneratedOnAdd()],
    ] as const)('allows a generated-on-add marker with %s', (_label, configure) => {
        expect(() => softDeleteModel(configure).build()).not.toThrow();
    });

    it('allows generated-on-add live defaults and performs a real delete update', async () => {
        const db = GeneratedAddSoftContext.create();
        await createSchema(db);
        const row = Object.assign(new GeneratedAddSoftRow(), {
            id: 'row-one',
            label: 'one',
        });
        db.rows.add(row);
        await db.saveChanges();

        db.rows.remove(row);

        await expect(db.saveChanges()).resolves.toBe(1);
        await expect(db.rows.find(row.id)).resolves.toBeNull();
        const stored = await db.database.connection.query<{
            deleted_at: unknown;
        }>({
            text: 'select deleted_at from generated_add_soft_rows where id = ?',
            values: [row.id],
        });
        expect(stored.rows[0]?.deleted_at).not.toBeNull();
        await db.dispose();
    });

    it('defensively rejects a default marker converted to provider null', async () => {
        const db = RuntimeNullSoftContext.create();
        await createSchema(db);
        const row = Object.assign(new RuntimeNullSoftRow(), {
            id: 'row-one',
            label: 'one',
        });
        db.rows.add(row);
        await db.saveChanges();
        db.rows.remove(row);

        await expect(db.saveChanges()).rejects.toThrow(
            'must write a non-null provider value, because SQL NULL represents a live row',
        );

        expect(row.deletedAt).toBeNull();
        expect(db.entry(row)?.state).toBe(EntityState.Deleted);
        await expect(db.rows.count()).resolves.toBe(1);
        await db.dispose();
    });

    it('does not recompute the provider value captured for delete SQL', async () => {
        collapseDuringBinding = false;
        const db = LateNullSoftContext.create();
        await createSchema(db);
        const row = Object.assign(new RuntimeNullSoftRow(), {
            id: 'row-one',
            label: 'one',
        });
        db.rows.add(row);
        await db.saveChanges();
        db.rows.remove(row);

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(row.deletedAt).not.toBeNull();
        expect(db.entry(row)?.state).toBe(EntityState.Unchanged);
        await expect(db.rows.count()).resolves.toBe(0);
        await db.dispose();
    });
});
