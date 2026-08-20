import { DeleteBehavior } from '../packages/core/src';
import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';

class PolicyParent {
    public id = '';
    public deletedAt: Date | null = null;
    public child: PolicyChild | null = null;
    public children: PolicyChild[] = [];
}

class PolicyChild {
    public id = '';
    public parentId: string | null = null;
    public deletedAt: Date | null = null;
    public parent: PolicyParent | null = null;
}

class NestedRoot {
    public id = '';
    public middles: NestedMiddle[] = [];
}

class NestedMiddle {
    public id = '';
    public rootId = '';
    public root: NestedRoot | null = null;
    public leaves: NestedLeaf[] = [];
}

class NestedLeaf {
    public id = '';
    public middleId = '';
    public deletedAt: Date | null = null;
    public middle: NestedMiddle | null = null;
}

function relationshipModel(options: {
    readonly parentSoft: boolean;
    readonly childSoft: boolean;
    readonly cardinality: 'one' | 'many';
    readonly optional: boolean;
    readonly behavior: DeleteBehavior;
}): ModelBuilderImplementation {
    const model = new ModelBuilderImplementation();
    model.entity(PolicyParent, entity => {
        entity.toTable('policy_parents');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.deletedAt).hasColumnName('deleted_at')
            .hasColumnType('timestamp').isOptional();
        if (options.parentSoft) entity.softDelete(row => row.deletedAt);
    });
    model.entity(PolicyChild, entity => {
        entity.toTable('policy_children');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        const foreignKey = entity.property(row => row.parentId)
            .hasColumnName('parent_id').hasColumnType('text');
        if (options.optional) foreignKey.isOptional();
        else foreignKey.isRequired();
        entity.property(row => row.deletedAt).hasColumnName('deleted_at')
            .hasColumnType('timestamp').isOptional();
        if (options.childSoft) entity.softDelete(row => row.deletedAt);
        const relationship = entity.hasOne(PolicyParent, row => row.parent);
        if (options.cardinality === 'one') {
            relationship.withOne(row => row.child)
                .hasForeignKey(row => row.parentId)
                .onDelete(options.behavior);
        } else {
            relationship.withMany(row => row.children)
                .hasForeignKey(row => row.parentId)
                .onDelete(options.behavior);
        }
    });
    return model;
}

describe('soft-delete cascade relationship model safety', () => {
    it.each([
        ['one', false],
        ['one', true],
        ['many', false],
        ['many', true],
    ] as const)(
        'rejects hard-principal/soft-dependent Cascade for %s, optional=%s',
        (cardinality, optional) => {
            const configured = relationshipModel({
                parentSoft: false,
                childSoft: true,
                cardinality,
                optional,
                behavior: DeleteBehavior.Cascade,
            });

            expect(() => configured.build()).toThrow(
                'Relationship \'parent\' on soft-deletable entity ' +
                '\'PolicyChild\' cannot use Cascade to hard-deletable ' +
                'principal \'PolicyParent\'',
            );
        },
    );

    it.each([
        ['soft principal and soft dependent', true, true, DeleteBehavior.Cascade],
        ['hard principal and hard dependent', false, false, DeleteBehavior.Cascade],
        ['hard principal and soft dependent NoAction', false, true, DeleteBehavior.NoAction],
        ['hard principal and soft dependent SetNull', false, true, DeleteBehavior.SetNull],
    ] as const)('allows %s', (_label, parentSoft, childSoft, behavior) => {
        const configured = relationshipModel({
            parentSoft,
            childSoft,
            cardinality: 'many',
            optional: behavior === DeleteBehavior.SetNull,
            behavior,
        });

        expect(() => configured.build()).not.toThrow();
    });

    it('rejects a nested hard cascade edge ending in a soft-dependent row', () => {
        const configured = new ModelBuilderImplementation();
        configured.entity(NestedRoot, entity => {
            entity.toTable('nested_roots');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        configured.entity(NestedMiddle, entity => {
            entity.toTable('nested_middles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.rootId).hasColumnType('text').isRequired();
            entity.hasOne(NestedRoot, row => row.root)
                .withMany(row => row.middles)
                .hasForeignKey(row => row.rootId)
                .onDelete(DeleteBehavior.Cascade);
        });
        configured.entity(NestedLeaf, entity => {
            entity.toTable('nested_leaves');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.middleId).hasColumnType('text').isRequired();
            entity.property(row => row.deletedAt).hasColumnType('timestamp')
                .isOptional();
            entity.softDelete(row => row.deletedAt);
            entity.hasOne(NestedMiddle, row => row.middle)
                .withMany(row => row.leaves)
                .hasForeignKey(row => row.middleId)
                .onDelete(DeleteBehavior.Cascade);
        });

        expect(() => configured.build()).toThrow(
            'soft-deletable entity \'NestedLeaf\' cannot use Cascade to ' +
            'hard-deletable principal \'NestedMiddle\'',
        );
    });

    it.each(['schema', 'migration snapshot'])(
        'fails before an invalid model can reach the %s path',
        path => {
            const configured = relationshipModel({
                parentSoft: false,
                childSoft: true,
                cardinality: 'many',
                optional: false,
                behavior: DeleteBehavior.Cascade,
            });

            const build = (): unknown => path === 'schema'
                ? configured.build()
                : configured.build().toSnapshot();
            expect(build).toThrow(
                'soft-deletable entity \'PolicyChild\' cannot use Cascade',
            );
        },
    );
});
