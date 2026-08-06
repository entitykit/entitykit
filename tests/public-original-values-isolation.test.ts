import { EntityState, valueConverter } from '../src';
import type { EntityMetadata } from '../src/model/entity-metadata';
import { ModelBuilder } from '../src/model/model-builder';
import { EntityEntry } from '../src/tracking/entity-entry';
import { publicEntityEntry } from '../src/tracking/public-entity-entry';

class ConvertedBytes {
    constructor(public readonly value: Uint8Array) {}
}

const convertedBytes = valueConverter<ConvertedBytes, Uint8Array>({
    toProvider: value => value.value,
    fromProvider: value => new ConvertedBytes(value),
});

class SnapshotBoundaryRow {
    public id = '';
    public occurredAt!: Date;
    public bytes!: Uint8Array;
    public converted!: ConvertedBytes;
    public token = '';
}

function metadata(): EntityMetadata<SnapshotBoundaryRow> {
    const model = new ModelBuilder();
    model.entity(SnapshotBoundaryRow, entity => {
        entity.toTable('snapshot_boundary_rows');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.occurredAt).hasColumnName('occurred_at')
            .hasColumnType('timestamp').isRequired();
        entity.property(row => row.bytes).hasColumnType('blob').isRequired();
        entity.property(row => row.converted).hasColumnType('blob')
            .hasConversion(convertedBytes).isRequired();
        entity.property(row => row.token).hasColumnType('text').isRequired()
            .isConcurrencyToken();
    });
    return model.build().getEntity(SnapshotBoundaryRow);
}

describe('public original value isolation', () => {
    it('protects binary, converted, and concurrency baselines', () => {
        const row = Object.assign(new SnapshotBoundaryRow(), {
            id: 'row-1',
            occurredAt: new Date('2026-08-05T12:00:00.000Z'),
            bytes: Uint8Array.from([1, 2, 3]),
            converted: new ConvertedBytes(Uint8Array.from([4, 5, 6])),
            token: 'token-1',
        });
        const internal = new EntityEntry(
            row,
            metadata(),
            EntityState.Unchanged,
        );
        const entry = publicEntityEntry(internal);
        const exposed = entry.originalValues as Record<string, unknown>;

        (exposed.occurredAt as Date).setUTCFullYear(2030);
        (exposed.bytes as Uint8Array)[0] = 9;
        (exposed.converted as ConvertedBytes).value[0] = 9;
        expect(() => {
            exposed.token = 'forged-token';
        }).toThrow(TypeError);

        const fresh = entry.originalValues;
        expect(fresh.occurredAt).toEqual(
            new Date('2026-08-05T12:00:00.000Z'),
        );
        expect(fresh.bytes).toEqual(Uint8Array.from([1, 2, 3]));
        expect((fresh.converted as ConvertedBytes).value)
            .toEqual(Uint8Array.from([4, 5, 6]));
        expect(fresh.token).toBe('token-1');
        expect(entry.modifiedProperties()).toEqual([]);
        expect(internal.originalValues).toMatchObject({
            id: 'row-1',
            token: 'token-1',
        });
    });
});
