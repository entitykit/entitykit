import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, valueConverter } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import {
    internalChangeTracker,
    internalEntityEntry,
    setMetadata,
} from './support/public-api-internals';

class CompositeCaptureRow {
    public partition = 'north';
    public idReads = 0;

    public get id(): string {
        this.idReads++;
        return this.idReads === 1 ? 'one' : 'two';
    }
}

class StrongId {
    constructor(public readonly value: string) {}
}

const strongIdConverter = valueConverter<StrongId, string>({
    toProvider: value => value.value,
    fromProvider: value => new StrongId(value),
});

class ConvertedCaptureRow {
    public idReads = 0;

    public get id(): StrongId {
        this.idReads++;
        return new StrongId(this.idReads === 1 ? 'one' : 'two');
    }
}

class TenantStamp {
    public tenantReads = 0;

    public get tenantId(): string {
        this.tenantReads++;
        return this.tenantReads === 1 ? 'tenant-one' : 'tenant-two';
    }
}

class NestedTenantCaptureRow {
    public id = 'shared';
    public scope = new TenantStamp();
}

class CaptureShapeContext extends DbContext {
    public compositeRows = this.set(CompositeCaptureRow);
    public convertedRows = this.set(ConvertedCaptureRow);
    public tenantRows = this.set(NestedTenantCaptureRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .allowCrossTenantAccess();
    }

    protected override model(model: ModelBuilder): void {
        model.entity(CompositeCaptureRow, entity => {
            entity.toTable('composite_capture_rows');
            entity.hasKey(row => [row.partition, row.id]);
            entity.property(row => row.partition)
                .hasColumnType('text').isRequired();
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(ConvertedCaptureRow, entity => {
            entity.toTable('converted_capture_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text')
                .hasConversion(strongIdConverter).isRequired();
        });
        model.entity(NestedTenantCaptureRow, entity => {
            entity.toTable('nested_tenant_capture_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.tenantKey(row => row.scope.tenantId);
            entity.complexProperty(
                row => row.scope,
                { constructor: TenantStamp, required: true },
                scope => scope.property(value => value.tenantId)
                    .hasColumnName('tenant_id').hasColumnType('text')
                    .isRequired(),
            );
        });
    }
}

describe('initial tracking value shapes', () => {
    it('captures every composite key member once', () => {
        const db = CaptureShapeContext.create();
        const row = new CompositeCaptureRow();

        const entry = db.compositeRows.attach(row);

        expect(row.idReads).toBe(1);
        expect(entry.originalValues).toMatchObject({
            partition: 'north',
            id: 'one',
        });
        expect(internalChangeTracker(db.changeTracker).tryGetByIdentityValues(
            setMetadata(db.compositeRows),
            ['north', 'one'],
        )).toBe(internalEntityEntry(entry));
    });

    it('reports a collision from the same captured composite key', () => {
        const db = CaptureShapeContext.create();
        const first = new CompositeCaptureRow();
        const duplicate = new CompositeCaptureRow();
        db.compositeRows.add(first);

        expect(() => db.compositeRows.add(duplicate)).toThrow(
            'key \'north,one\' is already tracked',
        );
        expect(first.idReads).toBe(1);
        expect(duplicate.idReads).toBe(1);
    });

    it('derives converted identity from the captured model value', () => {
        const db = CaptureShapeContext.create();
        const row = new ConvertedCaptureRow();

        const entry = db.convertedRows.attach(row);

        expect(row.idReads).toBe(1);
        expect((entry.originalValues.id as StrongId).value).toBe('one');
        expect(internalChangeTracker(db.changeTracker).tryGetByIdentity(
            setMetadata(db.convertedRows),
            new StrongId('one'),
        )).toBe(internalEntityEntry(entry));
    });

    it('derives nested tenant identity from the captured property path', () => {
        const db = CaptureShapeContext.create();
        const row = new NestedTenantCaptureRow();

        const entry = db.tenantRows.attach(row);

        expect(row.scope.tenantReads).toBe(1);
        expect(entry.originalValues['scope.tenantId']).toBe('tenant-one');
        expect(internalChangeTracker(db.changeTracker).tryGetByIdentityValues(
            setMetadata(db.tenantRows),
            ['shared'],
            'tenant-one',
        )).toBe(internalEntityEntry(entry));
    });
});
