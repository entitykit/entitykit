import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';import { mySqlDialect } from '../src/providers/mysql/mysql-dialect';
import { SchemaSqlBuilder } from '../src/schema/schema-sql-builder';

class Principal {
    public id!: string;
    public code!: string;
}

class Dependent {
    public id!: string;
    public principalCode!: string;
    public principal!: Principal;
}

describe('alternate-key schema ordering', () => {
    it('creates a principal unique constraint before a dependent table', () => {
        const model = new ModelBuilderImplementation();
        // Register the dependent first to prove DDL order comes from relationships,
        // not the order model configuration happened to run.
        model.entity(Dependent, entity => {
            entity.toTable('dependents');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('text').isRequired();
            entity.property(item => item.principalCode)
                .hasColumnName('principal_code').hasColumnType('text').isRequired();
            entity.hasOne(Principal, item => item.principal)
                .withMany()
                .hasForeignKey(item => item.principalCode)
                .hasPrincipalKey(item => item.code);
        });
        model.entity(Principal, entity => {
            entity.toTable('principals');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('text').isRequired();
            entity.property(item => item.code).hasColumnType('text').isRequired();
            entity.hasAlternateKey(item => item.code)
                .hasDatabaseName('ak_principals_code');
        });

        const sql = new SchemaSqlBuilder(mySqlDialect).build(model.build());

        expect(sql.indexOf('create table if not exists `principals`'))
            .toBeLessThan(sql.indexOf('create table if not exists `dependents`'));
        expect(sql).toContain(
            'constraint `ak_principals_code` unique (`code`)',
        );
        expect(sql).not.toContain(
            'create unique index `ak_principals_code`',
        );
    });

    it('preserves matching explicit index names and non-unique indexes', () => {
        const model = new ModelBuilderImplementation();
        model.entity(Principal, entity => {
            entity.toTable('principals');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('text').isRequired();
            entity.property(item => item.code).hasColumnType('text').isRequired();
            entity.hasIndex(item => item.code)
                .isUnique()
                .hasDatabaseName('ux_principals_natural');
            entity.hasIndex(item => item.code)
                .hasDatabaseName('ix_principals_lookup');
            entity.hasAlternateKey(item => item.code);
        });

        const sql = new SchemaSqlBuilder(mySqlDialect).build(model.build());

        expect(sql).toContain(
            'constraint `ux_principals_natural` unique (`code`)',
        );
        expect(sql).toContain(
            'create index `ix_principals_lookup` on `principals` (`code`)',
        );
        expect(sql).not.toContain(
            'create unique index `ux_principals_natural`',
        );
    });
});
