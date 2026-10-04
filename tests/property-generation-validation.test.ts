import type { PropertyBuilder } from '../packages/core/src';
import { ValueGenerated } from '../packages/core/src';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import { finalizeProperty } from '../packages/core/src/model/property-metadata-finalizer';

class ConfiguredRow {
    public id = 0;
    public value = 0;
}

type Configure = (property: PropertyBuilder<number>) => void;

function model(configure: Configure, valueIsKey = false): ModelBuilder {
    return new ModelBuilder().entity(ConfiguredRow, entity => {
        entity.toTable('configured_rows');
        if (valueIsKey) entity.hasKey(row => row.value);
        else entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer').isRequired();
        configure(entity.property(row => row.value).hasColumnType('integer').isRequired());
    });
}

const invalid: ReadonlyArray<readonly [string, Configure, string]> = [
    ['empty column name', property => property.hasColumnName(''), 'must configure a column name'],
    ['empty column type', property => property.hasColumnType(''), 'must configure a column type'],
    ['literal plus SQL default', property => property.hasDefaultValue(null).hasDefaultSql('1'), 'cannot configure both a default value and default SQL'],
    ['computed plus literal default', property => property.hasComputedColumnSql('1').hasDefaultValue(0), 'cannot also configure a default'],
    ['computed plus SQL default', property => property.hasComputedColumnSql('1').hasDefaultSql('1'), 'cannot also configure a default'],
    ['computed without generation', property => property.hasComputedColumnSql('1').valueGeneratedNever(), 'must remain generated on add or update'],
    ['computed only on insert', property => property.hasComputedColumnSql('1').valueGeneratedOnAdd(), 'must remain generated on add or update'],
    ['identity plus literal default', property => property.useIdentityColumn().hasDefaultValue(0), 'cannot also configure a default or computed expression'],
    ['identity plus SQL default', property => property.useIdentityColumn().hasDefaultSql('1'), 'cannot also configure a default or computed expression'],
    ['identity plus computed expression', property => property.useIdentityColumn().hasComputedColumnSql('1'), 'cannot also configure a default or computed expression'],
    ['identity without generation', property => property.useIdentityColumn().valueGeneratedNever(), 'must remain generated on add'],
    ['identity also on update', property => property.useIdentityColumn().valueGeneratedOnAddOrUpdate(), 'must remain generated on add'],
    ['version generated on insert', property => property.isVersion().valueGeneratedOnAdd(), 'cannot be database-generated'],
    ['version generated on update', property => property.isVersion().valueGeneratedOnAddOrUpdate(), 'cannot be database-generated'],
];

describe('property generation validation and metadata normalization', () => {
    it('normalizes a sparse ordinary column without introducing tracker roles', () => {
        const property = finalizeProperty(ConfiguredRow, {
            propertyName: 'value', columnName: 'counter', columnType: 'integer',
        });
        expect(property).toMatchObject({
            propertyName: 'value', columnName: 'counter', columnType: 'integer',
            propertyPath: ['value'],
            isRequired: false, isPrimaryKey: false, isUnique: false,
            isConcurrencyToken: false, isVersion: false,
            valueGenerated: ValueGenerated.Never,
        });
        expect(property.defaultValue).toBeUndefined();
        expect(property.defaultSql).toBeUndefined();
        expect(property.computedSql).toBeUndefined();
        expect(property.storeGeneration).toBeUndefined();
    });

    it('normalizes an application-owned version with unspecified generation', () => {
        const property = finalizeProperty(ConfiguredRow, {
            propertyName: 'value', columnName: 'version', columnType: 'integer',
            isRequired: true, isVersion: true, isConcurrencyToken: true,
        });
        expect(property.isVersion).toBe(true);
        expect(property.isConcurrencyToken).toBe(true);
        expect(property.valueGenerated).toBe(ValueGenerated.Never);
        expect(property.storeGeneration).toBeUndefined();
    });

    it.each(invalid)('rejects %s with an entity and property diagnostic', (_label, configure, message) => {
        expect(() => model(configure).build()).toThrow(
            new RegExp(`(?:Property|Computed property|Store-generated property|Version property) 'value' on entity 'ConfiguredRow' ${message}`),
        );
    });

    it('rejects a computed primary key before generating a schema', () => {
        expect(() => model(property => property.hasComputedColumnSql('1'), true).build())
            .toThrow('Primary key property \'value\' on entity \'ConfiguredRow\' cannot be computed.');
    });

    it('rejects a primary key that can change on update', () => {
        expect(() => model(property => property.valueGeneratedOnAddOrUpdate(), true).build())
            .toThrow('Primary key property \'value\' on entity \'ConfiguredRow\' cannot be generated on update.');
    });

    it.each([0, null, false, ''])('retains the supported literal default %s', value => {
        const property = model(builder => builder.hasDefaultValue(value)).build()
            .getEntity(ConfiguredRow).getProperty('value');
        expect(property.defaultValue).toBe(value);
        expect(property.defaultSql).toBeUndefined();
        expect(property.computedSql).toBeUndefined();
        expect(property.valueGenerated).toBe(ValueGenerated.Never);
    });

    it('retains a SQL default and an application-owned version', () => {
        const property = model(builder => builder.hasDefaultSql('1').isVersion().valueGeneratedNever())
            .build().getEntity(ConfiguredRow).getProperty('value');
        expect(property.defaultSql).toBe('1');
        expect(property.defaultValue).toBeUndefined();
        expect(property.isVersion).toBe(true);
        expect(property.isConcurrencyToken).toBe(true);
        expect(property.valueGenerated).toBe(ValueGenerated.Never);
    });

    it.each([true, false])('retains a computed column with stored=%s', stored => {
        const property = model(builder => builder.hasComputedColumnSql('id + 1', stored))
            .build().getEntity(ConfiguredRow).getProperty('value');
        expect(property.computedSql).toBe('id + 1');
        expect(property.computedStored).toBe(stored);
        expect(property.defaultValue).toBeUndefined();
        expect(property.defaultSql).toBeUndefined();
        expect(property.valueGenerated).toBe(ValueGenerated.OnAddOrUpdate);
    });

    it('accepts an identity primary key generated only on insert', () => {
        const builder = model(property => property.useIdentityColumn(), true);
        const property = builder.build().getEntity(ConfiguredRow).getProperty('value');
        expect(property.storeGeneration).toMatchObject({ kind: 'identity', mode: 'byDefault', isCyclic: false });
        expect(property.valueGenerated).toBe(ValueGenerated.OnAdd);
        expect(property.isPrimaryKey).toBe(true);
    });
});
