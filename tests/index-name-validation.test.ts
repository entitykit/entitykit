import type { EntityBuilder } from '../packages/core/src';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import { createModelSnapshot } from '../packages/core/src/model/model-snapshot-serializer';
import type { IndexSnapshot, ModelSnapshot } from '../packages/core/src/model/model-snapshot-types';
import { SchemaSqlBuilder } from '../packages/core/src/schema/schema-sql-builder';
import { diffModelSnapshots } from '../packages/core/src/migrations/api';

class StoredItem {
    public id!: string; public email!: string; public label!: string;
}
function items(configure?: (entity: EntityBuilder<StoredItem>) => void): ModelBuilder {
    return new ModelBuilder().entity(StoredItem, entity => {
        entity.toTable('indexed_records').hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.email).hasColumnName('email_address').hasColumnType('text').isRequired();
        entity.property(row => row.label).hasColumnType('text').isRequired();
        configure?.(entity);
    });
}
function snapshot(indexes: readonly IndexSnapshot[]): ModelSnapshot {
    const original = createModelSnapshot(items().build());
    return { ...original, entities: original.entities.map(entity => ({ ...entity, indexes })) };
}

describe('physical index-name validation', () => {
    it('refuses two configured definitions with the same explicit name', () => {
        expect(() => items(entity => {
            entity.hasIndex(row => row.email).hasDatabaseName('ix_shared');
            entity.hasIndex(row => row.label).hasDatabaseName('ix_shared');
        }).build()).toThrow('Entity \'StoredItem\' maps multiple indexes to database name \'ix_shared\'. Configure distinct index database names.');
    });
    it('refuses a configured partial index colliding with inferred property uniqueness', () => {
        expect(() => items(entity => {
            entity.property(row => row.email).isUnique();
            entity.hasIndex(row => row.email).isUnique().hasFilter('label <> \'hidden\'');
        }).build()).toThrow('database name \'ux_indexed_records_email_address\'');
    });
    it('validates names after an alternate key supplies its backing-index name', () => {
        expect(() => items(entity => {
            entity.hasIndex(row => row.email).isUnique();
            entity.hasAlternateKey(row => row.email).hasDatabaseName('shared_key');
            entity.hasIndex(row => row.label).hasDatabaseName('shared_key');
        }).build()).toThrow('database name \'shared_key\'');
    });
    it('keeps distinct default names for unique and non-unique indexes on the same physical column', () => {
        const model = items(entity => {
            entity.hasIndex(row => row.email).isUnique();
            entity.hasIndex(row => row.email);
        }).build();
        const sql = new SchemaSqlBuilder().build(model);
        expect(sql).toContain('"ux_indexed_records_email_address"');
        expect(sql).toContain('"ix_indexed_records_email_address"');
        const plan = diffModelSnapshots({ formatVersion: 1, entities: [] }, createModelSnapshot(model));
        expect(plan.operations.filter(operation => operation.kind === 'createIndex').map(operation => operation.name))
            .toEqual(['ux_indexed_records_email_address', 'ix_indexed_records_email_address']);
    });
    it('accepts two distinct explicit names without changing generated identity', () => {
        const model = items(entity => {
            entity.hasIndex(row => row.email).hasDatabaseName('ix_email');
            entity.hasIndex(row => row.label).hasDatabaseName('ix_label');
        }).build();
        const sql = new SchemaSqlBuilder().build(model);
        expect(sql).toContain('"ix_email"');
        expect(sql).toContain('"ix_label"');
        expect(diffModelSnapshots(createModelSnapshot(model), createModelSnapshot(model)).hasChanges).toBe(false);
    });
    it('preserves equivalent property and explicit unique-index declarations', () => {
        const model = items(entity => {
            entity.property(row => row.email).isUnique();
            entity.hasIndex(row => row.email).isUnique().hasDatabaseName('ux_indexed_records_email_address');
        }).build();
        const current = createModelSnapshot(model);
        expect(current.entities[0]?.indexes).toHaveLength(2);
        expect(new SchemaSqlBuilder().build(model)).toContain('"ux_indexed_records_email_address"');
        expect(diffModelSnapshots(current, current).hasChanges).toBe(false);
    });
    it('preserves equivalent complete expression, filter and included-column declarations', () => {
        const model = items(entity => {
            for (let declaration = 0; declaration < 2; declaration++) {
                entity.hasIndex([{ kind: 'expression', expression: 'lower(email_address)' }, { kind: 'property', propertyName: 'id' }])
                    .isUnique().includeProperties(row => row.label).hasFilter('label <> \'hidden\'').hasDatabaseName('ux_visible_email');
            }
        }).build();
        const current = createModelSnapshot(model);
        expect(current.entities[0]?.indexes).toHaveLength(2);
        expect(diffModelSnapshots(current, current).hasChanges).toBe(false);
    });
    it('accepts property descriptors equivalent to legacy property-only keys', () => {
        const equivalent = snapshot([
            { propertyNames: ['email'], isUnique: true },
            { propertyNames: ['email'], isUnique: true, keyParts: [{ kind: 'property', propertyName: 'email' }], includedPropertyNames: [] },
        ]);
        expect(diffModelSnapshots(equivalent, equivalent).hasChanges).toBe(false);
    });
    it.each<Partial<IndexSnapshot>>([
        { isUnique: false }, { propertyNames: ['label', 'email'] },
        { includedPropertyNames: ['id'] }, { filter: 'label is not null' },
        { keyParts: [{ kind: 'expression', expression: 'lower(email_address)' }, { kind: 'property', propertyName: 'label' }] },
    ])('refuses a complete-key, uniqueness, include or filter mismatch: %j', difference => {
        const index = { propertyNames: ['email', 'label'], isUnique: true, databaseName: 'shared_index' };
        const invalid = snapshot([index, { ...index, ...difference }]);
        expect(() => diffModelSnapshots(invalid, invalid)).toThrow('database name \'shared_index\'');
    });
    it('refuses different expressions under one physical name', () => {
        const expressionIndex = { propertyNames: [], isUnique: true, databaseName: 'shared_expression' };
        const invalid = snapshot([
            { ...expressionIndex, keyParts: [{ kind: 'expression', expression: 'lower(email_address)' }] },
            { ...expressionIndex, keyParts: [{ kind: 'expression', expression: 'upper(email_address)' }] },
        ]);
        expect(() => diffModelSnapshots(invalid, invalid)).toThrow('database name \'shared_expression\'');
    });
    it('refuses conflicting metadata at schema rendering after initial model validation', () => {
        const model = items(entity => {
            entity.hasIndex(row => row.email).hasDatabaseName('ix_email');
            entity.hasIndex(row => row.label).hasDatabaseName('ix_label');
        }).build();
        Object.defineProperty(model.getEntity(StoredItem).indexes[1], 'databaseName', { value: 'ix_email' });
        expect(() => new SchemaSqlBuilder().build(model)).toThrow('database name \'ix_email\'');
    });

    it.each(['from', 'to'] as const)('rejects ambiguous default names in a supplied %s snapshot', side => {
        const invalid = snapshot([
            { propertyNames: ['email'], isUnique: true },
            { propertyNames: ['email'], isUnique: true, filter: 'label <> \'hidden\'' },
        ]);
        const original = snapshot([]);
        expect(() => diffModelSnapshots(side === 'from' ? invalid : original, side === 'to' ? invalid : original))
            .toThrow('database name \'ux_indexed_records_email_address\'');
    });
    it.each(['from', 'to'] as const)('rejects mixed/configured name collisions in a supplied %s snapshot', side => {
        const invalid = snapshot([
            { propertyNames: ['email'], isUnique: true },
            { propertyNames: ['email'], isUnique: true, databaseName: 'ux_indexed_records_email_address',
                keyParts: [{ kind: 'expression', expression: 'lower(label)' }, { kind: 'property', propertyName: 'email' }] },
        ]);
        expect(() => diffModelSnapshots(side === 'from' ? invalid : snapshot([]), side === 'to' ? invalid : snapshot([])))
            .toThrow('database name \'ux_indexed_records_email_address\'');
    });
    it('checks retained legacy physical-column names without inventing a different default identifier', () => {
        const invalid = snapshot([
            { propertyNames: ['email_address'], isUnique: true },
            { propertyNames: ['email'], isUnique: true, filter: 'label <> \'hidden\'' },
        ]);
        expect(() => diffModelSnapshots(invalid, invalid)).toThrow('database name \'ux_indexed_records_email_address\'');
    });
});
