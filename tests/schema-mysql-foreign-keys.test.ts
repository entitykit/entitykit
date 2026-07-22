import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import { requireDefined } from './support/require-defined';import { mySqlDialect } from '../src/providers/mysql';
import { SchemaSqlBuilder } from '../src/schema/schema-sql-builder';

/**
 * Two MySQL-only schema hazards a text-keyed relationship hits, which Postgres
 * and SQLite tolerate: a `text` foreign-key column MySQL cannot key,
 * and a generated constraint name past MySQL's 64-character identifier limit.
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

function buildModel(parentTable: string, childTable: string): ModelBuilderImplementation {
    const model = new ModelBuilderImplementation();
    model.entity(Parent, entity => {
        entity.toTable(parentTable);
        entity.hasKey(parent => parent.id);
        entity.property(parent => parent.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(parent => parent.name).hasColumnName('name').hasColumnType('text').isRequired();
    });
    model.entity(Child, entity => {
        entity.toTable(childTable);
        entity.hasKey(child => child.id);
        entity.property(child => child.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(child => child.parentId).hasColumnName('parent_id').hasColumnType('text').isRequired();
        entity.hasOne(Parent, child => child.parent).withMany(parent => parent.children).hasForeignKey(child => child.parentId);
    });
    return model;
}

describe('SchemaSqlBuilder MySQL foreign keys', () => {
    it('bounds a text foreign-key column so MySQL can key it', () => {
        const sql = new SchemaSqlBuilder(mySqlDialect).build(buildModel('parents', 'children').build());

        // The foreign-key column is bounded to match the key it references, not the
        // unbounded `text` MySQL refuses in a key specification.
        expect(sql).toContain('`parent_id` varchar(255) collate utf8mb4_bin not null');
        expect(sql).toContain('`id` varchar(255) collate utf8mb4_bin');
        expect(sql).toContain('foreign key (`parent_id`) references `parents` (`id`)');
        // A plain text column that backs no key stays unbounded text.
        expect(sql).toContain('`name` text collate utf8mb4_bin');
    });

    it('bounds a generated constraint name to the identifier limit every provider shares', () => {
    // These table names make the default name `fk_..._parent_id` 65 characters.
        const sql = new SchemaSqlBuilder(mySqlDialect).build(
            buildModel('provider_contract_parents', 'provider_contract_children').build(),
        );

        const match = /constraint `([^`]+)` foreign key/.exec(sql);
        expect(match).not.toBeNull();
        expect(requireDefined(match)[1].length).toBeLessThanOrEqual(64);
        // Still readable: it keeps the descriptive prefix and adds a hash for uniqueness.
        expect(requireDefined(match)[1].startsWith('fk_provider_contract_children')).toBe(true);
    });
});
