import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import {
    EntityState,
} from '../packages/core/src';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { cloneSnapshotValue, EntityEntry } from '../packages/core/src/tracking/entity-entry';
import { publicEntityEntry } from '../packages/core/src/tracking/public-entity-entry';

class Document {
    public id!: string;
    public title!: string;
    public updatedAt!: Date;

    constructor(data?: Partial<Document>) {
        Object.assign(this, data);
    }
}

function createDocumentMetadata(): EntityMetadata<Document> {
    const model = new ModelBuilderImplementation();
    model.entity(Document, entity => {
        entity.toTable('documents');
        entity.hasKey(document => document.id);
        entity.property(document => document.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(document => document.title).hasColumnName('title').hasColumnType('text').isRequired();
        entity.property(document => document.updatedAt).hasColumnName('updated_at').hasColumnType('timestamptz').isRequired();
    });
    return model.build().getEntity(Document);
}

describe('EntityEntry', () => {
    it('clones Date snapshots and compares them by timestamp', () => {
        const updatedAt = new Date('2026-01-01T00:00:00.000Z');
        const document = new Document({
            id: 'doc_1',
            title: 'Draft',
            updatedAt,
        });
        const entry = new EntityEntry(
            document,
            createDocumentMetadata(),
            EntityState.Unchanged,
        );

        expect(entry.originalValues.updatedAt).toEqual(updatedAt);
        expect(entry.originalValues.updatedAt).not.toBe(updatedAt);

        document.updatedAt = new Date(updatedAt);
        expect(entry.modifiedProperties()).toEqual([]);
        entry.detectChanges();
        expect(entry.state).toBe(EntityState.Unchanged);

        document.updatedAt = new Date('2026-01-02T00:00:00.000Z');
        expect(entry.modifiedProperties()).toEqual(['updatedAt']);
        entry.detectChanges();
        expect(entry.state).toBe(EntityState.Modified);
    });

    it('isolates current and refreshed Date values from their sources', () => {
        const document = new Document({
            id: 'doc_1',
            title: 'Draft',
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        const entry = new EntityEntry(
            document,
            createDocumentMetadata(),
            EntityState.Unchanged,
        );

        const current = entry.currentValues();
        expect(current.updatedAt).toEqual(document.updatedAt);
        expect(current.updatedAt).not.toBe(document.updatedAt);

        const refreshedDate = new Date('2026-02-01T00:00:00.000Z');
        entry.refreshOriginalValues({
            id: document.id,
            title: document.title,
            updatedAt: refreshedDate,
        });
        refreshedDate.setUTCDate(2);

        expect(entry.originalValues.updatedAt).toEqual(
            new Date('2026-02-01T00:00:00.000Z'),
        );
    });

    it('deeply clones structured snapshot values while preserving Date semantics', () => {
        const date = new Date('2026-01-01T00:00:00.000Z');
        const object = {
            nested: { id: 1 },
            dates: [date],
            bytes: new Uint8Array([1, 2, 3]),
        };
        const clonedDate = cloneSnapshotValue(date);
        const clonedObject = cloneSnapshotValue(object) as typeof object;

        expect(clonedDate).toEqual(date);
        expect(clonedDate).not.toBe(date);
        expect(clonedObject).toEqual(object);
        expect(clonedObject).not.toBe(object);
        expect(clonedObject.nested).not.toBe(object.nested);
        expect(clonedObject.dates).not.toBe(object.dates);
        expect(clonedObject.dates[0]).not.toBe(date);
        expect(clonedObject.bytes).not.toBe(object.bytes);
        expect(clonedObject.bytes).toEqual(object.bytes);
        expect(cloneSnapshotValue('value')).toBe('value');
    });

    it('clones cyclic snapshot values without retaining live references', () => {
        const value: { name: string; self?: unknown } = { name: 'before' };
        value.self = value;

        const cloned = cloneSnapshotValue(value) as typeof value;
        value.name = 'after';

        expect(cloned).not.toBe(value);
        expect(cloned.name).toBe('before');
        expect(cloned.self).toBe(cloned);
    });

    it('returns isolated public original values on every read', () => {
        const document = new Document({
            id: 'doc_1',
            title: 'Draft',
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        const internal = new EntityEntry(
            document,
            createDocumentMetadata(),
            EntityState.Unchanged,
        );
        const entry = publicEntityEntry(internal);
        const first = entry.originalValues;
        const second = entry.originalValues;

        expect(Object.isFrozen(first)).toBe(true);
        expect(first).not.toBe(second);
        expect(first.updatedAt).not.toBe(second.updatedAt);
        (first.updatedAt as Date).setUTCFullYear(2030);

        expect(second.updatedAt).toEqual(
            new Date('2026-01-01T00:00:00.000Z'),
        );
        expect(entry.modifiedProperties()).toEqual([]);
        expect(internal.originalValues.updatedAt).toEqual(
            new Date('2026-01-01T00:00:00.000Z'),
        );
    });
});
