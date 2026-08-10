import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import type { PropertyMetadata } from '../src/model/property-metadata';
import { resolveUpsertProperties } from '../src/sql/upsert-property-selection';

class ManagedRow {
    public id = '';
    public partition = '';
    public externalCode = '';
    public externalRegion = '';
    public version = 0;
    public etag = '';
    public createdAt = '';
    public updatedAt = '';
    public createdBy = '';
    public updatedBy = '';
    public deletedAt: string | null = null;
    public generatedValue = '';
    public label = '';
}

const metadata = (() => {
    const model = new ModelBuilderImplementation();
    model.entity(ManagedRow, entity => {
        entity.toTable('managed_rows');
        entity.hasKey(row => [row.id, row.partition]);
        entity.hasAlternateKey(row => [row.externalCode, row.externalRegion]);
        entity.audit({
            createdAt: row => row.createdAt,
            updatedAt: row => row.updatedAt,
            createdBy: row => row.createdBy,
            updatedBy: row => row.updatedBy,
        });
        entity.softDelete(row => row.deletedAt);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.partition).hasColumnType('text').isRequired();
        entity.property(row => row.externalCode).hasColumnType('text').isRequired();
        entity.property(row => row.externalRegion).hasColumnType('text').isRequired();
        entity.property(row => row.version).hasColumnType('integer').isRequired().isVersion();
        entity.property(row => row.etag).hasColumnType('text').isRequired().isConcurrencyToken();
        entity.property(row => row.createdAt).hasColumnType('text').isRequired();
        entity.property(row => row.updatedAt).hasColumnType('text').isRequired();
        entity.property(row => row.createdBy).hasColumnType('text').isRequired();
        entity.property(row => row.updatedBy).hasColumnType('text').isRequired();
        entity.property(row => row.deletedAt).hasColumnType('text');
        entity.property(row => row.generatedValue).hasColumnType('text')
            .hasDefaultSql('\'generated\'').valueGeneratedOnAdd();
        entity.property(row => row.label).hasColumnType('text').isRequired();
    });
    return model.build().getEntity(ManagedRow);
})();

function resolve(updateProperties?: Array<keyof ManagedRow>): {
    readonly conflictProperties: Array<PropertyMetadata<ManagedRow>>;
    readonly updateProperties: Array<PropertyMetadata<ManagedRow>>;
} {
    return resolveUpsertProperties(metadata, {
        conflictProperties: ['id', 'partition'],
        updateProperties,
    });
}

describe('upsert managed property selection', () => {
    it('keeps every immutable and ORM-managed property out of default updates', () => {
        expect(resolve().updateProperties.map(property => property.propertyName))
            .toEqual(['label']);
    });

    it.each([
        ['id', 'primary-key'],
        ['partition', 'primary-key'],
        ['externalCode', 'alternate-key'],
        ['externalRegion', 'alternate-key'],
        ['version', 'version'],
    ] as const)('rejects explicit %s updates as %s properties', (property, kind) => {
        expect(() => resolve([property, 'label'])).toThrow(
            `cannot include ${kind} property 'ManagedRow.${property}'`,
        );
    });

    it('allows deliberate administrative updates outside version and key identity', () => {
        expect(resolve(['etag', 'updatedAt', 'deletedAt']).updateProperties
            .map(property => property.propertyName))
            .toEqual(['etag', 'updatedAt', 'deletedAt']);
    });
});
