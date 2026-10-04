import { DbContext, DeleteBehavior, type DbContextOptionsBuilder, type ModelBuilder } from '../../packages/core/src';
import { sqliteProviderServices } from '../../packages/sqlite/src';
import { contextMigrations } from '../../packages/core/src/migrations/api';
import type { ModelSnapshot } from '../../packages/core/src/model/model-snapshot-types';

class JoinEntry {
    public id = '';
    public tenant = '';
    public label = '';
    public tags: JoinTag[] = [];
    public featuredTags: JoinTag[] = [];
}

class JoinTag {
    public id = '';
    public tenant = '';
    public label = '';
    public entries: JoinEntry[] = [];
    public featuredEntries: JoinEntry[] = [];
}

class RetiredJoinRow {
    public id = '';
}

export interface JoinRenameOptions {
    readonly sourceRenamed?: boolean;
    readonly targetRenamed?: boolean;
    readonly schema?: string;
    readonly composite?: boolean;
    readonly optionalLabel?: boolean;
    readonly retiredTable?: boolean;
    readonly omitJoin?: boolean;
    readonly reciprocal?: boolean;
    readonly secondJoinSchema?: string;
    readonly secondJoinName?: string;
    readonly targetTable?: string;
}

export class JoinRenameContext extends DbContext {
    constructor(private readonly settings: JoinRenameOptions = {}) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(JoinEntry, entity => {
            entity.toTable('join_entries', this.settings.schema);
            entity.property(row => row.id).hasColumnName(this.settings.sourceRenamed ? 'entry_key' : 'legacy_id')
                .hasColumnType('varchar(64)').isRequired();
            entity.property(row => row.tenant).hasColumnType('varchar(64)').isRequired();
            const label = entity.property(row => row.label).hasColumnType('text');
            if (this.settings.optionalLabel) label.isOptional();
            else label.isRequired();
            entity.hasKey(row => this.settings.composite ? [row.tenant, row.id] : row.id);
            if (!this.settings.omitJoin) entity.hasManyToMany(JoinTag, row => row.tags).withMany(row => row.entries)
                .usingJoinTable('join_entry_tags', join => {
                    if (this.settings.schema !== undefined) join.hasSchema(this.settings.schema);
                    join.primaryKeyName('pk_join_associations').sourceConstraintName('fk_join_entry').targetConstraintName('fk_join_tag');
                    join.sourceForeignKey(this.settings.composite ? ['entry_tenant', 'entry_id'] : 'entry_id')
                        .targetForeignKey(this.settings.composite ? ['tag_tenant', 'tag_id'] : 'tag_id');
                }).onDelete(DeleteBehavior.Restrict);
            if (this.settings.secondJoinName !== undefined) {
                entity.hasManyToMany(JoinTag, row => row.featuredTags).withMany(row => row.featuredEntries)
                    .usingJoinTable(this.settings.secondJoinName, join => {
                        if (this.settings.secondJoinSchema !== undefined) join.hasSchema(this.settings.secondJoinSchema);
                        join.sourceForeignKey('featured_entry').targetForeignKey('featured_tag');
                    });
            }
        });
        model.entity(JoinTag, entity => {
            entity.toTable(this.settings.targetTable ?? 'join_tags', this.settings.schema);
            entity.property(row => row.id).hasColumnName(this.settings.targetRenamed ? 'tag_key' : 'legacy_id')
                .hasColumnType('varchar(64)').isRequired();
            entity.property(row => row.tenant).hasColumnType('varchar(64)').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.hasKey(row => this.settings.composite ? [row.tenant, row.id] : row.id);
            if (this.settings.reciprocal) {
                entity.hasManyToMany(JoinEntry, row => row.featuredEntries).withMany(row => row.featuredTags)
                    .usingJoinTable('join_entry_tags', join => {
                        if (this.settings.schema !== undefined) join.hasSchema(this.settings.schema);
                        join.primaryKeyName('pk_join_associations').sourceConstraintName('fk_join_tag').targetConstraintName('fk_join_entry');
                        join.sourceForeignKey(this.settings.composite ? ['tag_tenant', 'tag_id'] : 'tag_id')
                            .targetForeignKey(this.settings.composite ? ['entry_tenant', 'entry_id'] : 'entry_id');
                    }).onDelete(DeleteBehavior.Restrict);
            }
        });
        if (this.settings.retiredTable) model.entity(RetiredJoinRow, entity => {
            entity.toTable('retired_join_rows', this.settings.schema);
            entity.property(row => row.id).hasColumnType('varchar(64)').isRequired();
            entity.hasKey(row => row.id);
        });
    }
}

export async function joinRows(context: JoinRenameContext, text: string): Promise<unknown> {
    return (await context.database.connection.query({ text, values: [] })).rows;
}

export async function joinSnapshot(settings: JoinRenameOptions = {}): Promise<ModelSnapshot> {
    const context = JoinRenameContext.create(settings);
    try {
        return contextMigrations(context).createModelSnapshot();
    } finally {
        await context.dispose();
    }
}

export async function seedJoinCatalog(context: JoinRenameContext, composite: boolean): Promise<void> {
    await joinRows(context, 'insert into join_entries values (\'book\', \'tenant\', \'Novel\')');
    await joinRows(context, 'insert into join_tags values (\'tag\', \'tenant\', \'Fiction\')');
    await joinRows(context, composite
        ? 'insert into join_entry_tags values (\'tenant\', \'book\', \'tenant\', \'tag\')'
        : 'insert into join_entry_tags values (\'book\', \'tag\')');
}

export async function expectJoinCatalog(context: JoinRenameContext, settings: JoinRenameOptions): Promise<void> {
    expect(await joinRows(context, `select ${settings.sourceRenamed ? 'entry_key' : 'legacy_id'} as id, tenant, label from join_entries`))
        .toEqual([{ id: 'book', tenant: 'tenant', label: 'Novel' }]);
    expect(await joinRows(context, `select ${settings.targetRenamed ? 'tag_key' : 'legacy_id'} as id, tenant, label from ${settings.targetTable ?? 'join_tags'}`))
        .toEqual([{ id: 'tag', tenant: 'tenant', label: 'Fiction' }]);
    expect(await joinRows(context, 'select * from join_entry_tags')).toEqual([settings.composite
        ? { entry_tenant: 'tenant', entry_id: 'book', tag_tenant: 'tenant', tag_id: 'tag' }
        : { entry_id: 'book', tag_id: 'tag' }]);
    expect(await joinRows(context, 'pragma foreign_key_check')).toEqual([]);
    expect(await joinRows(context, 'pragma foreign_keys')).toEqual([{ foreign_keys: 1 }]);
    expect(await joinRows(context, 'select instr(sql, \'constraint "pk_join_associations" primary key\') > 0 as named from sqlite_master where name = \'join_entry_tags\''))
        .toEqual([{ named: 1 }]);
    expect(await joinRows(context, 'select name from pragma_table_info(\'join_entry_tags\') where "notnull" <> 1')).toEqual([]);
    if (settings.composite) {
        for (const table of ['join_entries', settings.targetTable ?? 'join_tags']) expect(await joinRows(context, `select pk from pragma_table_info('${table}') order by cid`))
            .toEqual([{ pk: 2 }, { pk: 1 }, { pk: 0 }]);
    }
    const invalid = settings.composite
        ? ['(\'tenant\', \'missing\', \'tenant\', \'tag\')', '(\'tenant\', \'book\', \'tenant\', \'missing\')', '(\'other\', \'book\', \'tenant\', \'tag\')']
        : ['(\'missing\', \'tag\')', '(\'book\', \'missing\')'];
    for (const values of invalid) await expect(joinRows(context, `insert into join_entry_tags values ${values}`)).rejects.toThrow();
    await expect(joinRows(context, 'delete from join_entries')).rejects.toThrow();
    await expect(joinRows(context, `delete from ${settings.targetTable ?? 'join_tags'}`)).rejects.toThrow();
}
