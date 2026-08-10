import type {
    DbContextOptionsBuilder,
    EntityBuilder,
    ModelBuilder,
} from '../src';
import { DbContext, valueConverter } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import type { PropertyPathSelector } from '../src/model/model-property-selector';

const deletedAt = new Date('2026-08-10T12:34:56.000Z');
const dateText = valueConverter<Date, string>({
    toProvider: value => value.toISOString(),
    fromProvider: value => new Date(value),
});

class MarkerRow {
    public id = '';
    public label = '';
    public timestamp: Date | null = null;
    public text: string | null = null;
    public flag: boolean | null = null;
    public code: number | null = null;
    public convertedAt: Date | null = null;
}

abstract class MarkerContext extends DbContext {
    public rows = this.set(MarkerRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:').useAuditing({
            now: () => deletedAt,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(MarkerRow, entity => {
            entity.toTable('marker_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.timestamp).hasColumnType('timestamp');
            entity.property(row => row.text).hasColumnType('text');
            entity.property(row => row.flag).hasColumnType('boolean');
            entity.property(row => row.code).hasColumnType('integer');
            entity.property(row => row.convertedAt).hasColumnName('converted_at')
                .hasColumnType('text').hasConversion(dateText);
            this.configureMarker(entity);
        });
    }

    protected abstract configureMarker(entity: EntityBuilder<MarkerRow>): void;
}

class TimestampContext extends MarkerContext {
    protected override configureMarker(entity: EntityBuilder<MarkerRow>): void {
        entity.softDelete(row => row.timestamp);
    }
}

class StringContext extends MarkerContext {
    protected override configureMarker(entity: EntityBuilder<MarkerRow>): void {
        entity.softDelete(row => row.text, 'deleted');
    }
}

class BooleanContext extends MarkerContext {
    protected override configureMarker(entity: EntityBuilder<MarkerRow>): void {
        entity.softDelete(row => row.flag, true);
    }
}

class NumericContext extends MarkerContext {
    protected override configureMarker(entity: EntityBuilder<MarkerRow>): void {
        entity.softDelete(row => row.code, 7);
    }
}

class ConvertedTimestampContext extends MarkerContext {
    protected override configureMarker(entity: EntityBuilder<MarkerRow>): void {
        entity.softDelete(row => row.convertedAt);
    }
}

async function remove(
    db: MarkerContext,
    column: string,
): Promise<{ row: MarkerRow; stored: unknown }> {
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    const row = Object.assign(new MarkerRow(), {
        id: 'row-one',
        label: 'one',
    });
    db.rows.add(row);
    await db.saveChanges();
    db.rows.remove(row);
    await db.saveChanges();
    const result = await db.database.connection.query({
        text: `select ${column} as marker from marker_rows where id = ?`,
        values: [row.id],
    });
    return { row, stored: result.rows[0]?.marker };
}

describe('soft-delete marker contract', () => {
    it('keeps the omitted timestamp marker a Date in memory', async () => {
        const db = TimestampContext.create();
        const result = await remove(db, 'timestamp');
        expect(result.row.timestamp).toEqual(deletedAt);
        expect(result.row.timestamp).toBeInstanceOf(Date);
        expect(typeof result.stored).toBe('string');
        await db.dispose();
    });

    it.each([
        ['string', () => StringContext.create(), 'text', 'text', 'deleted'],
        ['boolean', () => BooleanContext.create(), 'flag', 'flag', 1],
        ['numeric', () => NumericContext.create(), 'code', 'code', 7],
    ] as const)('retains an explicit %s marker type', async (
        _label,
        create,
        property,
        column,
        expected,
    ) => {
        const db = create();
        const result = await remove(db, column);
        expect(result.row[property]).toBe(
            property === 'flag' ? true : expected,
        );
        expect(result.stored).toBe(expected);
        await db.dispose();
    });

    it('supports an explicit converter-backed Date convention', async () => {
        const db = ConvertedTimestampContext.create();
        const result = await remove(db, 'converted_at');
        expect(result.row.convertedAt).toEqual(deletedAt);
        expect(result.row.convertedAt).toBeInstanceOf(Date);
        expect(result.stored).toBe(deletedAt.toISOString());
        await db.dispose();
    });

    it('rejects an untyped omitted marker on a non-temporal column', () => {
        const model = new ModelBuilderImplementation();
        model.entity(MarkerRow, entity => {
            entity.toTable('marker_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.text).hasColumnType('text');
            const unsafe = entity as unknown as {
                softDelete(
                    selector: PropertyPathSelector<MarkerRow, string | null>,
                ): unknown;
            };
            unsafe.softDelete(row => row.text);
        });

        expect(() => model.build()).toThrow(
            'must configure an explicit deleted value unless it uses the Date timestamp convention',
        );
    });

    it('rejects an untyped property-name omission without a convention', () => {
        const model = new ModelBuilderImplementation();
        model.entity(MarkerRow, entity => {
            entity.toTable('marker_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.text).hasColumnType('text');
            const unsafe = entity as unknown as {
                softDelete(propertyName: string): unknown;
            };
            unsafe.softDelete('text');
        });

        expect(() => model.build()).toThrow(
            'must configure an explicit deleted value unless it uses the Date timestamp convention',
        );
    });

    it('does not infer the timestamp convention for a property-name omission', () => {
        const model = new ModelBuilderImplementation();
        model.entity(MarkerRow, entity => {
            entity.toTable('marker_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.timestamp).hasColumnType('timestamp');
            const unsafe = entity as unknown as {
                softDelete(propertyName: string): unknown;
            };
            unsafe.softDelete('timestamp');
        });

        expect(() => model.build()).toThrow(
            'must configure an explicit deleted value unless it uses the Date timestamp convention',
        );
    });

    it.each([
        'date',
        ' datetime(6) ',
        ' timestamp with time zone ',
    ])('recognizes the temporal %s column convention', columnType => {
        const model = new ModelBuilderImplementation();
        model.entity(MarkerRow, entity => {
            entity.toTable('marker_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.timestamp).hasColumnType(columnType);
            entity.softDelete(row => row.timestamp);
        });

        expect(() => model.build()).not.toThrow();
    });
});
