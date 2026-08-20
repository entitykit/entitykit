import type { PropertyBuilder } from '../packages/core/src';
import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';

class GeneratedRelationshipOwner {
    public id = '';
    public dependents: GeneratedRelationshipDependent[] = [];
}

class GeneratedRelationshipDependent {
    public id = '';
    public ownerId = '';
    public owner?: GeneratedRelationshipOwner;
}

function generatedRelationshipModel(
    configure: (property: PropertyBuilder<string>) => void,
): ModelBuilderImplementation {
    return new ModelBuilderImplementation()
        .entity(GeneratedRelationshipOwner, entity => {
            entity.toTable('generated_relationship_owners');
            entity.hasKey(row => row.id);
            entity.property(row => row.id)
                .hasColumnType('text').isRequired();
        })
        .entity(GeneratedRelationshipDependent, entity => {
            entity.toTable('generated_relationship_dependents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id)
                .hasColumnType('text').isRequired();
            configure(entity.property(row => row.ownerId)
                .hasColumnName('owner_id').hasColumnType('text').isRequired());
            entity.hasOne(GeneratedRelationshipOwner, row => row.owner)
                .withMany(owner => owner.dependents)
                .hasForeignKey(row => row.ownerId);
        });
}

describe('generated relationship foreign-key validation', () => {
    it.each([
        ['generated on add', (property: PropertyBuilder<string>) =>
            property.hasDefaultSql('\'owner\'').valueGeneratedOnAdd()],
        ['generated on add or update', (property: PropertyBuilder<string>) =>
            property.valueGeneratedOnAddOrUpdate()],
        ['computed', (property: PropertyBuilder<string>) =>
            property.hasComputedColumnSql('\'owner\'')],
    ] as const)('rejects a relationship foreign key that is %s', (
        _label,
        configure,
    ) => {
        expect(() => generatedRelationshipModel(configure).build()).toThrow(
            'Property \'GeneratedRelationshipDependent.ownerId\' cannot ' +
            'combine database-generated and relationship foreign-key roles.',
        );
    });
});
