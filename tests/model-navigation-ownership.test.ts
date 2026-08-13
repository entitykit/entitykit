import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';

class Owner {
    public id = '';
    public dependents: FirstDependent[] = [];
    public profile: FirstDependent | null = null;
}

class FirstDependent {
    public id = '';
    public ownerId = '';
    public owner: Owner | null = null;
    public owners: Owner[] = [];
}

class SecondDependent {
    public id = '';
    public ownerId = '';
    public owner: Owner | null = null;
}

function baseModel(): ModelBuilderImplementation {
    const model = new ModelBuilderImplementation();
    model.entity(Owner, entity => {
        entity.toTable('owners');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
    });
    for (const [ctor, table] of [
        [FirstDependent, 'first_dependents'],
        [SecondDependent, 'second_dependents'],
    ] as const) {
        model.entity(ctor, entity => {
            entity.toTable(table);
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.ownerId).hasColumnType('text').isRequired();
        });
    }
    return model;
}

describe('model navigation ownership', () => {
    it('rejects a duplicate inverse collection navigation', () => {
        const model = baseModel();
        model.entity(FirstDependent, entity => {
            entity.hasOne(Owner, row => row.owner)
                .withMany(owner => owner.dependents)
                .hasForeignKey(row => row.ownerId);
        });
        model.entity(SecondDependent, entity => {
            entity.hasOne(Owner, row => row.owner)
                .withMany(owner => owner.dependents)
                .hasForeignKey(row => row.ownerId);
        });

        expect(() => model.build()).toThrow(
            'Navigation \'Owner.dependents\' is claimed by more than one relationship',
        );
    });

    it('rejects a duplicate one-to-one inverse navigation', () => {
        const model = baseModel();
        model.entity(FirstDependent, entity => {
            entity.hasOne(Owner, row => row.owner)
                .withOne(owner => owner.profile)
                .hasForeignKey(row => row.ownerId);
        });
        model.entity(SecondDependent, entity => {
            entity.hasOne(Owner, row => row.owner)
                .withOne(owner => owner.profile)
                .hasForeignKey(row => row.ownerId);
        });

        expect(() => model.build()).toThrow(
            'Navigation \'Owner.profile\' is claimed by more than one relationship',
        );
    });

    it('rejects a reused forward navigation', () => {
        const model = baseModel();
        model.entity(FirstDependent, entity => {
            entity.hasOne(Owner, row => row.owner)
                .withMany()
                .hasForeignKey(row => row.ownerId);
            entity.hasOne(Owner, row => row.owner)
                .withOne()
                .hasForeignKey(row => row.ownerId);
        });

        expect(() => model.build()).toThrow(
            'Navigation \'FirstDependent.owner\' is claimed by more than one relationship',
        );
    });

    it('rejects an ordinary and many-to-many navigation collision', () => {
        const model = baseModel();
        model.entity(Owner, entity => {
            entity.hasManyToMany(FirstDependent, owner => owner.dependents)
                .withMany(dependent => dependent.owners)
                .usingJoinTable('owner_dependents', join => {
                    join.sourceForeignKey('owner_id');
                    join.targetForeignKey('dependent_id');
                });
        });
        model.entity(FirstDependent, entity => {
            entity.hasOne(Owner, row => row.owner)
                .withMany(owner => owner.dependents)
                .hasForeignKey(row => row.ownerId);
        });

        expect(() => model.build()).toThrow(
            'Navigation \'Owner.dependents\' is claimed by more than one relationship',
        );
    });
});
