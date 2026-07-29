import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';import { createModelSnapshot } from '../src/model/model-snapshot';
import type { EntityBuilder } from '../src';

class EmptyValue {
    public text?: string;
    public nested?: NestedValue;
}

class NestedValue {
    public text?: string;
}

class ComplexEntity {
    public id!: string;
    public value!: EmptyValue;
}

function baseModel(
    configure: (entity: EntityBuilder<ComplexEntity>) => void,
): ModelBuilderImplementation {
    const model = new ModelBuilderImplementation();
    model.entity(ComplexEntity, entity => {
        entity.toTable('complex_entities');
        entity.hasKey(item => item.id);
        entity.property(item => item.id).hasColumnType('text').isRequired();
        configure(entity);
    });
    return model;
}

describe('complex property model metadata', () => {
    it('records object paths while snapshots remain flattened schema', () => {
        const model = baseModel(entity => {
            entity.complexProperty(
                item => item.value,
                { constructor: EmptyValue, required: true },
                value => {
                    value.property(item => item.text)
                        .hasColumnName('value_text').hasColumnType('text').isOptional();
                },
            );
        }).build();
        const metadata = model.getEntity(ComplexEntity);
        const property = metadata.getProperty('value.text');

        expect(property.propertyPath).toEqual(['value', 'text']);
        expect(metadata.complexProperties).toEqual([{
            propertyName: 'value',
            propertyPath: ['value'],
            isRequired: true,
            ctor: EmptyValue,
        }]);
        expect(createModelSnapshot(model).entities[0].properties)
            .toContainEqual(expect.objectContaining({
                propertyName: 'value.text',
                columnName: 'value_text',
            }));
    });

    it('uses path-based default column names', () => {
        const model = baseModel(entity => {
            entity.complexProperty(item => item.value, value => {
                value.property(item => item.text).hasColumnType('text');
            });
        }).build();

        expect(model.getEntity(ComplexEntity)
            .getProperty('value.text').columnName).toBe('value_text');
    });

    it('requires every complex object to map at least one leaf', () => {
        const model = baseModel(entity => {
            entity.complexProperty(item => item.value);
        });

        expect(() => model.build()).toThrow(
            'Complex property \'ComplexEntity.value\' must configure at least one mapped property.',
        );
    });

    it('rejects required leaves beneath an optional complex property', () => {
        const model = baseModel(entity => {
            entity.complexProperty(item => item.value, value => {
                value.property(item => item.text).hasColumnType('text').isRequired();
            });
        });

        expect(() => model.build()).toThrow(
            'Optional complex property \'ComplexEntity.value\' cannot contain required leaf \'value.text\'. Make the complex property required or configure the leaf as optional.',
        );
    });

    it('rejects scalar and complex mappings over the same property', () => {
        expect(() => baseModel(entity => {
            entity.property(item => item.value).hasColumnType('text');
            entity.complexProperty(item => item.value, value => {
                value.property(item => item.text).hasColumnType('text');
            });
        })).toThrow(
            'Property \'value\' on \'ComplexEntity\' already maps a column and cannot also be complex.',
        );

        expect(() => baseModel(entity => {
            entity.complexProperty(item => item.value, value => {
                value.property(item => item.text).hasColumnType('text');
            });
            entity.property(item => item.value).hasColumnType('text');
        })).toThrow(
            'Property \'value\' on \'ComplexEntity\' is configured as a complex property',
        );
    });

    it('rejects nested scalar/complex conflicts and ignored roots', () => {
        expect(() => baseModel(entity => {
            entity.complexProperty(item => item.value, value => {
                value.complexProperty(item => item.nested, nested => {
                    nested.property(item => item.text).hasColumnType('text');
                });
                value.property(item => item.nested).hasColumnType('text');
            });
        })).toThrow(
            'Property \'value.nested\' on \'ComplexEntity\' is configured as a complex property',
        );

        expect(() => baseModel(entity => {
            entity.ignore(item => item.value);
            entity.complexProperty(item => item.value, value => {
                value.property(item => item.text).hasColumnType('text');
            });
        })).toThrow(
            'Property \'value\' on entity \'ComplexEntity\' is ignored',
        );

        expect(() => baseModel(entity => {
            entity.complexProperty(item => item.value, value => {
                value.property(item => item.text).hasColumnType('text');
            });
            entity.ignore(item => item.value);
        })).toThrow(
            'Property \'value\' on entity \'ComplexEntity\' cannot be ignored',
        );
    });

    it('rejects duplicate complex configuration and column collisions', () => {
        expect(() => baseModel(entity => {
            entity.complexProperty(item => item.value, value => {
                value.property(item => item.text).hasColumnType('text');
            });
            entity.complexProperty(item => item.value, value => {
                value.property(item => item.text).hasColumnType('text');
            });
        })).toThrow(
            'Complex property \'ComplexEntity.value\' is already configured.',
        );

        const model = baseModel(entity => {
            entity.complexProperty(item => item.value, value => {
                value.property(item => item.text)
                    .hasColumnName('id').hasColumnType('text');
            });
        });
        expect(() => model.build()).toThrow(
            'maps properties \'id\' and \'value.text\' to the same column \'id\'',
        );
    });

    it('requires direct selectors inside each builder level', () => {
        expect(() => baseModel(entity => {
            entity.complexProperty(item => item.value, value => {
                value.property(
                    ((
                        item: { text: { trim: string } },
                    ) => item.text.trim) as never,
                ).hasColumnType('text');
            });
        })).toThrow('must select one direct property');
    });
});
