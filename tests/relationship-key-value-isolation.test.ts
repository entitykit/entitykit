import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, valueConverter } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class PrincipalMutableKey {
    constructor(public readonly bytes: Uint8Array) {}
}

class DependentMutableKey {
    constructor(public readonly bytes: Uint8Array) {}
}

const principalKeyConverter = valueConverter<
    PrincipalMutableKey,
    Uint8Array
>({
    toProvider: value => value.bytes,
    fromProvider: value => new PrincipalMutableKey(value),
});

const dependentKeyConverter = valueConverter<
    DependentMutableKey,
    Uint8Array
>({
    toProvider: value => value.bytes,
    fromProvider: value => new DependentMutableKey(value),
});

class MutableKeyParent {
    public occurredAt!: Date;
    public binaryId!: Uint8Array;
    public convertedId!: PrincipalMutableKey;
    public name = '';
    public children: MutableKeyChild[] = [];
}

class MutableKeyChild {
    public id = '';
    public parentOccurredAt!: Date;
    public parentBinaryId!: Uint8Array;
    public parentConvertedId!: DependentMutableKey;
    public parent?: MutableKeyParent;
}

class MutableRelationshipKeyContext extends DbContext {
    public parents = this.set(MutableKeyParent);
    public children = this.set(MutableKeyChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(MutableKeyParent, entity => {
            entity.toTable('mutable_key_parents');
            entity.hasKey(parent => [
                parent.occurredAt,
                parent.binaryId,
                parent.convertedId,
            ]);
            entity.property(parent => parent.occurredAt)
                .hasColumnName('occurred_at').hasColumnType('timestamp')
                .isRequired();
            entity.property(parent => parent.binaryId)
                .hasColumnName('binary_id').hasColumnType('blob').isRequired();
            entity.property(parent => parent.convertedId)
                .hasColumnName('converted_id').hasColumnType('blob')
                .hasConversion(principalKeyConverter).isRequired();
            entity.property(parent => parent.name).hasColumnType('text')
                .isRequired();
        });
        model.entity(MutableKeyChild, entity => {
            entity.toTable('mutable_key_children');
            entity.hasKey(child => child.id);
            entity.property(child => child.id).hasColumnType('text').isRequired();
            entity.property(child => child.parentOccurredAt)
                .hasColumnName('parent_occurred_at').hasColumnType('timestamp')
                .isRequired();
            entity.property(child => child.parentBinaryId)
                .hasColumnName('parent_binary_id').hasColumnType('blob')
                .isRequired();
            entity.property(child => child.parentConvertedId)
                .hasColumnName('parent_converted_id').hasColumnType('blob')
                .hasConversion(dependentKeyConverter).isRequired();
            entity.hasOne(MutableKeyParent, child => child.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(child => [
                    child.parentOccurredAt,
                    child.parentBinaryId,
                    child.parentConvertedId,
                ]);
        });
    }
}

describe('relationship key value isolation', () => {
    it('copies every mutable composite component during fix-up', async () => {
        const db = MutableRelationshipKeyContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        const parent = Object.assign(new MutableKeyParent(), {
            occurredAt: new Date('2026-08-05T12:00:00.000Z'),
            binaryId: Uint8Array.from([1, 2, 3]),
            convertedId: new PrincipalMutableKey(Uint8Array.from([4, 5, 6])),
            name: 'parent',
        });
        const child = Object.assign(new MutableKeyChild(), {
            id: 'child-1',
            parent,
        });
        parent.children = [child];
        db.children.add(child);
        db.parents.add(parent);

        expect(db.getSavePlan().map(entry => entry.entityName)).toEqual([
            'MutableKeyParent',
            'MutableKeyChild',
        ]);
        expect(child.parentOccurredAt).toBeUndefined();
        expect(child.parentBinaryId).toBeUndefined();
        expect(child.parentConvertedId).toBeUndefined();

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(child.parentOccurredAt).toEqual(parent.occurredAt);
        expect(child.parentOccurredAt).not.toBe(parent.occurredAt);
        expect(child.parentBinaryId).toEqual(parent.binaryId);
        expect(child.parentBinaryId).not.toBe(parent.binaryId);
        expect(child.parentConvertedId).toBeInstanceOf(DependentMutableKey);
        expect(child.parentConvertedId.bytes).toEqual(parent.convertedId.bytes);
        expect(child.parentConvertedId.bytes).not.toBe(parent.convertedId.bytes);

        child.parentOccurredAt.setUTCFullYear(2030);
        child.parentBinaryId[0] = 9;
        child.parentConvertedId.bytes[0] = 9;

        expect(parent.occurredAt).toEqual(
            new Date('2026-08-05T12:00:00.000Z'),
        );
        expect(parent.binaryId).toEqual(Uint8Array.from([1, 2, 3]));
        expect(parent.convertedId.bytes).toEqual(Uint8Array.from([4, 5, 6]));
        await db.dispose();
    });
});
