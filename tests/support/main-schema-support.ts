import { DbContext, type DbContextOptionsBuilder, type ModelBuilder } from '../../packages/core/src';
import { sqliteProviderServices } from '../../packages/sqlite/src';

class SchemaEntry {
    public id = '';
    public code = '';
    public label = '';
    public normalized = '';
    public links: SchemaLink[] = [];
    public tags: SchemaTag[] = [];
}

class SchemaLink {
    public id = '';
    public ownerCode = '';
    public entry: SchemaEntry | null = null;
}

class SchemaTag {
    public id = '';
    public entries: SchemaEntry[] = [];
}

export class MainSchemaContext extends DbContext {
    constructor(private readonly schema: string | undefined, private readonly joinSchema = schema) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(SchemaEntry, entity => {
            entity.toTable('schema_entries', this.schema);
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('varchar(64)').isRequired();
            entity.property(row => row.code).hasColumnType('varchar(64)').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired().useCollation('NOCASE');
            entity.property(row => row.normalized).hasColumnType('text').hasComputedColumnSql('lower(label)', true);
            entity.hasAlternateKey(row => row.code).hasDatabaseName('ak_schema_entry_code');
            entity.hasIndex(row => row.label).hasDatabaseName('ix_schema_entry_label');
            entity.hasManyToMany(SchemaTag, row => row.tags).withMany(row => row.entries)
                .usingJoinTable('schema_entry_tags', join => {
                    if (this.joinSchema !== undefined) join.hasSchema(this.joinSchema);
                    join.sourceForeignKey('entry_id').targetForeignKey('tag_id');
                });
        });
        model.entity(SchemaLink, entity => {
            entity.toTable('schema_links', this.schema);
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('varchar(64)').isRequired();
            entity.property(row => row.ownerCode).hasColumnName('owner_code').hasColumnType('varchar(64)').isRequired();
            entity.hasOne(SchemaEntry, row => row.entry).withMany(row => row.links)
                .hasForeignKey(row => row.ownerCode).hasPrincipalKey(row => row.code)
                .hasConstraintName('fk_schema_link_entry');
        });
        model.entity(SchemaTag, entity => {
            entity.toTable('schema_tags', this.schema);
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('varchar(64)').isRequired();
        });
    }
}

export async function schemaRows(context: MainSchemaContext, text: string): Promise<unknown> {
    return (await context.database.connection.query({ text, values: [] })).rows;
}

export async function seedMainSchema(context: MainSchemaContext): Promise<void> {
    await schemaRows(context, 'insert into schema_entries (id, code, label) values (\'book\', \'edition\', \'Novel\')');
    await schemaRows(context, 'insert into schema_links values (\'link\', \'edition\')');
    await schemaRows(context, 'insert into schema_tags values (\'tag\')');
    await schemaRows(context, 'insert into schema_entry_tags values (\'book\', \'tag\')');
}

export async function expectMainSchemaState(context: MainSchemaContext): Promise<void> {
    expect(await schemaRows(context, 'select id, code, label, normalized from schema_entries')).toEqual([
        { id: 'book', code: 'edition', label: 'Novel', normalized: 'novel' },
    ]);
    expect(await schemaRows(context, 'select * from schema_links')).toEqual([{ id: 'link', owner_code: 'edition' }]);
    expect(await schemaRows(context, 'select * from schema_entry_tags')).toEqual([{ entry_id: 'book', tag_id: 'tag' }]);
    expect(await schemaRows(context, 'select id from schema_entries where label = \'NOVEL\'')).toEqual([{ id: 'book' }]);
    expect(await schemaRows(context, 'select name from sqlite_master where name = \'ix_schema_entry_label\''))
        .toEqual([{ name: 'ix_schema_entry_label' }]);
    expect(await schemaRows(context, 'pragma foreign_key_check')).toEqual([]);
    expect(await schemaRows(context, 'pragma foreign_keys')).toEqual([{ foreign_keys: 1 }]);
    await expect(schemaRows(context, 'insert into schema_links values (\'invalid\', \'missing\')')).rejects.toThrow();
    await expect(schemaRows(context, 'insert into schema_entry_tags values (\'book\', \'missing\')')).rejects.toThrow();
}
