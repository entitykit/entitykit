import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';

class Principal {
    public id = '';
    public tenantId = '';
    public code = '';
    public dependents?: Dependent[];
}

class Dependent {
    public id = '';
    public parentId = 0;
    public tenantId = '';
    public parentCode = '';
    public version = 0;
    public parent?: Principal | null;
}

type RelationshipKind = 'scalar' | 'composite' | 'alternate';

function versionForeignKeyModel(
    kind: RelationshipKind,
    inverse: boolean,
    versioned = true,
): ModelBuilderImplementation {
    const model = new ModelBuilderImplementation();
    model.entity(Principal, entity => {
        entity.toTable('principals');
        entity.hasKey(row => kind === 'composite'
            ? [row.tenantId, row.id]
            : row.id);
        entity.property(row => row.id).hasColumnType('integer').isRequired();
        entity.property(row => row.tenantId).hasColumnName('tenant_id')
            .hasColumnType('text').isRequired();
        entity.property(row => row.code).hasColumnType('text').isRequired();
        entity.hasAlternateKey(row => row.code);
    });
    model.entity(Dependent, entity => {
        entity.toTable('dependents');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.parentId).hasColumnName('parent_id')
            .hasColumnType('integer').isRequired();
        entity.property(row => row.tenantId).hasColumnName('tenant_id')
            .hasColumnType('text').isRequired();
        entity.property(row => row.parentCode).hasColumnName('parent_code')
            .hasColumnType('text').isRequired();
        entity.property(row => row.version).hasColumnType('integer')
            .isRequired();
        const relationship = entity.hasOne(Principal, row => row.parent);
        if (inverse) relationship.withMany(row => row.dependents);
        else relationship.withMany();
        if (kind === 'scalar') {
            if (versioned) entity.property(row => row.parentId).isVersion();
            relationship.hasForeignKey(row => row.parentId);
        } else if (kind === 'composite') {
            if (versioned) entity.property(row => row.parentId).isVersion();
            relationship.hasForeignKey(row => [row.tenantId, row.parentId]);
        } else {
            if (versioned) entity.property(row => row.parentCode).isVersion();
            relationship.hasForeignKey(row => row.parentCode)
                .hasPrincipalKey(row => row.code);
        }
    });
    return model;
}

describe('version foreign-key validation', () => {
    it.each([
        ['scalar', true, 'parentId'],
        ['scalar', false, 'parentId'],
        ['composite', true, 'parentId'],
        ['alternate', true, 'parentCode'],
    ] as const)(
        'rejects %s version foreign keys with inverse=%s',
        (kind, inverse, property) => {
            expect(() => versionForeignKeyModel(kind, inverse).build())
                .toThrow(
                    `Property 'Dependent.${property}' cannot combine version and relationship foreign-key roles`,
                );
        },
    );

    it('accepts the same relationships when versioning is separate', () => {
        const model = versionForeignKeyModel('scalar', true, false);
        model.entity(Dependent, entity => {
            entity.property(row => row.version).isVersion();
        });

        expect(() => model.build()).not.toThrow();
    });
});
