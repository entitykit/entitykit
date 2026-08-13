import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import { boundedIdentifier } from '../src/relational-identifiers';
import { valueConverter } from '../src';

class RelationshipOwner {
    public id = '';
    public region = '';
}

class ClaimedDependent {
    public id = '';
    public ownerId = '';
    public ownerRegion = '';
    public alternateOwnerId = '';
    public ownership = { ownerId: '' };
    public first: RelationshipOwner | null = null;
    public second: RelationshipOwner | null = null;
}

const normalizedFk = valueConverter<string, string>({
    toProvider: value => value.toLowerCase(),
    fromProvider: value => value,
});

function model(): ModelBuilderImplementation {
    const model = new ModelBuilderImplementation();
    model.entity(RelationshipOwner, entity => {
        entity.toTable('relationship_owners');
        entity.hasKey(row => [row.id, row.region]);
        entity.property(row => row.id).hasColumnName('id')
            .hasColumnType('text').isRequired();
        entity.property(row => row.region).hasColumnName('region')
            .hasColumnType('text').isRequired();
        entity.hasAlternateKey(row => row.id);
    });
    model.entity(ClaimedDependent, entity => {
        entity.toTable('claimed_dependents');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.ownerId).hasColumnName('owner_id')
            .hasColumnType('text').isRequired().hasConversion(normalizedFk);
        entity.property(row => row.ownerRegion).hasColumnName('owner_region')
            .hasColumnType('text').isRequired();
        entity.property(row => row.alternateOwnerId)
            .hasColumnName('alternate_owner_id')
            .hasColumnType('text').isRequired();
        entity.complexProperty(row => row.ownership, ownership => {
            ownership.property(value => value.ownerId)
                .hasColumnType('text').isRequired();
        }).isRequired();
    });
    return model;
}

describe('model relationship ownership', () => {
    it('rejects two navigation names claiming one scalar FK tuple', () => {
        const configured = model();
        configured.entity(ClaimedDependent, entity => {
            entity.hasOne(RelationshipOwner, row => row.first)
                .withMany()
                .hasForeignKey(row => row.ownerId)
                .hasPrincipalKey(row => row.id);
            entity.hasOne(RelationshipOwner, row => row.second)
                .withMany()
                .hasForeignKey(row => row.ownerId)
                .hasPrincipalKey(row => row.id);
        });

        expect(() => configured.build()).toThrow(
            'Foreign-key properties (ownerId) on entity ' +
            '\'ClaimedDependent\' are claimed by more than one relationship: ' +
            '\'first\' and \'second\'',
        );
    });

    it('rejects two navigation names claiming one composite FK tuple', () => {
        const configured = model();
        configured.entity(ClaimedDependent, entity => {
            entity.hasOne(RelationshipOwner, row => row.first)
                .withMany()
                .hasForeignKey(row => [row.ownerId, row.ownerRegion]);
            entity.hasOne(RelationshipOwner, row => row.second)
                .withMany()
                .hasForeignKey(row => [row.ownerId, row.ownerRegion]);
        });

        expect(() => configured.build()).toThrow(
            'Foreign-key properties (ownerId, ownerRegion) on entity ' +
            '\'ClaimedDependent\' are claimed by more than one relationship',
        );
    });

    it('rejects a reversed composite FK tuple with a converted component', () => {
        const configured = model();
        configured.entity(ClaimedDependent, entity => {
            entity.hasOne(RelationshipOwner, row => row.first)
                .withMany()
                .hasForeignKey(row => [row.ownerId, row.ownerRegion]);
            entity.hasOne(RelationshipOwner, row => row.second)
                .withMany()
                .hasForeignKey(row => [row.ownerRegion, row.ownerId]);
        });

        expect(() => configured.build()).toThrow(
            'Foreign-key properties (ownerRegion, ownerId) on entity ' +
            '\'ClaimedDependent\' are claimed by more than one relationship',
        );
    });

    it('rejects duplicate ownership of a nested property path', () => {
        const configured = model();
        configured.entity(ClaimedDependent, entity => {
            entity.hasOne(RelationshipOwner, row => row.first)
                .withMany()
                .hasForeignKey('ownership.ownerId' as keyof ClaimedDependent)
                .hasPrincipalKey(row => row.id);
            entity.hasOne(RelationshipOwner, row => row.second)
                .withMany()
                .hasForeignKey('ownership.ownerId' as keyof ClaimedDependent)
                .hasPrincipalKey(row => row.id);
        });

        expect(() => configured.build()).toThrow(
            'Foreign-key properties (ownership.ownerId) on entity ' +
            '\'ClaimedDependent\' are claimed by more than one relationship',
        );
    });

    it('rejects duplicate provider constraint identifiers', () => {
        const configured = model();
        configured.entity(ClaimedDependent, entity => {
            entity.hasOne(RelationshipOwner, row => row.first)
                .withMany()
                .hasForeignKey(row => row.ownerId)
                .hasPrincipalKey(row => row.id)
                .hasConstraintName('fk_claimed_dependents_owner');
            entity.hasOne(RelationshipOwner, row => row.second)
                .withMany()
                .hasForeignKey(row => row.alternateOwnerId)
                .hasPrincipalKey(row => row.id)
                .hasConstraintName('fk_claimed_dependents_owner');
        });

        expect(() => configured.build()).toThrow(
            'Foreign-key constraint identifier ' +
            '\'fk_claimed_dependents_owner\' on table ' +
            '\'claimed_dependents\' is claimed by relationships ' +
            '\'first\' and \'second\'',
        );
    });

    it('rejects duplicate constraint identifiers after provider bounding', () => {
        const configured = model();
        const longName = 'fk_claimed_dependents_relationship_owner_' +
            'shared_identifier_that_exceeds_provider_limits';
        configured.entity(ClaimedDependent, entity => {
            entity.hasOne(RelationshipOwner, row => row.first)
                .withMany()
                .hasForeignKey(row => row.ownerId)
                .hasPrincipalKey(row => row.id)
                .hasConstraintName(longName);
            entity.hasOne(RelationshipOwner, row => row.second)
                .withMany()
                .hasForeignKey(row => row.alternateOwnerId)
                .hasPrincipalKey(row => row.id)
                .hasConstraintName(longName);
        });

        expect(() => configured.build()).toThrow(
            `Foreign-key constraint identifier '${boundedIdentifier(longName)}'`,
        );
        expect(Buffer.byteLength(boundedIdentifier(longName), 'utf8'))
            .toBeLessThanOrEqual(63);
    });

    it('accepts distinct FK tuples and provider identifiers', () => {
        const configured = model();
        configured.entity(ClaimedDependent, entity => {
            entity.hasOne(RelationshipOwner, row => row.first)
                .withMany()
                .hasForeignKey(row => row.ownerId)
                .hasPrincipalKey(row => row.id);
            entity.hasOne(RelationshipOwner, row => row.second)
                .withMany()
                .hasForeignKey(row => row.alternateOwnerId)
                .hasPrincipalKey(row => row.id);
        });

        expect(() => configured.build()).not.toThrow();
    });
});
