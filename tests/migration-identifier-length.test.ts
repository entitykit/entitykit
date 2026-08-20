import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';import type { ModelSnapshot } from '../packages/core/src/tooling';
import { createModelSnapshot } from '../packages/core/src/model/model-snapshot';
import { diffModelSnapshots } from '../packages/core/src/migrations/api';

/**
 * A model diff generates default foreign-key and index names, which must fit the
 * identifier limit every provider shares (Postgres 63, MySQL 64) — long table
 * names would otherwise produce a name MySQL rejects with ER_TOO_LONG_IDENT.
 * The createSchemaScript path is already bounded; this is the
 * migration path.
 */
class Parent {
    public id!: string;
    public name!: string;
    public children?: Child[];
}

class Child {
    public id!: string;
    public parentId!: string;
    public parent?: Parent;
}

// Long enough that `fk_<child>_parent_id` and `ix_<child>_parent_id` exceed 63.
const PARENT_TABLE = 'a_really_quite_long_provider_contract_parent_table_name';
const CHILD_TABLE = 'a_really_quite_long_provider_contract_child_table_name';

function buildSnapshot(): ModelSnapshot {
    const model = new ModelBuilderImplementation();
    model.entity(Parent, entity => {
        entity.toTable(PARENT_TABLE);
        entity.hasKey(parent => parent.id);
        entity.property(parent => parent.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(parent => parent.name).hasColumnName('name').hasColumnType('text').isRequired();
    });
    model.entity(Child, entity => {
        entity.toTable(CHILD_TABLE);
        entity.hasKey(child => child.id);
        entity.property(child => child.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(child => child.parentId).hasColumnName('parent_id').hasColumnType('text').isRequired();
        // No explicit names, so both default generators run.
        entity.hasIndex(child => child.parentId);
        entity.hasOne(Parent, child => child.parent).withMany(parent => parent.children).hasForeignKey(child => child.parentId);
    });
    return createModelSnapshot(model.build());
}

describe('migration default identifier names', () => {
    it('bounds generated foreign-key and index names to the shared identifier limit', () => {
        const diff = diffModelSnapshots({ formatVersion: 1, entities: [] }, buildSnapshot());

        const generated = diff.operations
            .filter((operation): operation is typeof operation & { name: string } =>
                (operation.kind === 'addForeignKey' || operation.kind === 'createIndex') && 'name' in operation)
            .map(operation => operation.name);

        // Both a foreign key and an index were generated, and each unbounded name
        // would exceed the limit.
        expect(generated).toHaveLength(2);
        for (const name of generated) {
            expect(name.length).toBeLessThanOrEqual(64);
        }
    });
});
