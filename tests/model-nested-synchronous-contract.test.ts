import { ModelValidationError } from '../packages/core/src';
import { ModelBuilder } from '../packages/core/src/model/model-builder';

class Coordinates {
    public latitude!: number;
}

class Address {
    public city!: string;
    public coordinates!: Coordinates;
}

class ComplexUser {
    public id!: string;
    public address!: Address;
}

class Role {
    public id!: string;
    public users!: ManyUser[];
}

class ManyUser {
    public id!: string;
    public roles!: Role[];
}

describe('nested model synchronous callback contract', () => {
    it('rejects async complex-property configuration', () => {
        const builder = new ModelBuilder();

        expect(() => builder.entity(ComplexUser, entity => {
            entity.toTable('complex_users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnType('text');
            entity.complexProperty(
                user => user.address,
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                async address => {
                    address.property(value => value.city).hasColumnType('text');
                    await Promise.resolve();
                },
            );
        })).toThrow(ModelValidationError);
        expect(() => builder.build()).toThrow(
            'EntityBuilder.complexProperty() callback must be synchronous',
        );
    });

    it('rejects async nested complex-property configuration', () => {
        expect(() => new ModelBuilder().entity(ComplexUser, entity => {
            entity.complexProperty(user => user.address, address => {
                address.complexProperty(
                    value => value.coordinates,
                    // eslint-disable-next-line @typescript-eslint/no-misused-promises
                    async coordinates => {
                        await Promise.resolve();
                        coordinates.property(value => value.latitude);
                    },
                );
            });
        })).toThrow(
            'ComplexPropertyBuilder.complexProperty() callback must be synchronous',
        );
    });

    it('rejects async many-to-many join-table configuration', () => {
        expect(() => new ModelBuilder().entity(ManyUser, entity => {
            entity.hasManyToMany(Role, user => user.roles).usingJoinTable(
                'user_roles',
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                async join => {
                    join.sourceForeignKey('user_id');
                    await Promise.resolve();
                    join.targetForeignKey('role_id');
                },
            );
        })).toThrow(
            'ManyToManyRelationshipBuilder.usingJoinTable() callback must be synchronous',
        );
    });
});
