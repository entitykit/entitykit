import type { DbContextOptionsBuilder, ModelBuilder } from '../../src';
import { DbContext, DeleteBehavior } from '../../src';
import { sqliteProviderServices } from '../../src/providers/sqlite';

export class NestOwner {
    public id = '';
    public principals: NestPrincipal[] = [];
}

export class NestPrincipal {
    public id = '';
    public ownerId = '';
    public owner: NestOwner | null = null;
    public dependents: NestDependent[] = [];
    public tags: NestTag[] = [];
}

export class NestDependent {
    public id = '';
    public principalId = '';
    public principal: NestPrincipal | null = null;
}

export class NestTag {
    public id = '';
    public principals: NestPrincipal[] = [];
}

/** SQLite graph deep enough for three include levels, with a linked pair. */
export class NestedIncludeContext extends DbContext {
    /** Called with each include level's navigation as that level finishes. */
    public onIncludeLevel?: (navigationProperty: string) => void;
    /** Called with each completed statement, before its rows are used. */
    public onQuery?: (sql: string) => void;

    public owners = this.set(NestOwner);
    public principals = this.set(NestPrincipal);
    public dependents = this.set(NestDependent);
    public tags = this.set(NestTag);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
        options.useDiagnostics(event => {
            if (event.kind === 'include') {
                this.onIncludeLevel?.(event.navigationProperty);
            }
            if (event.kind === 'query') this.onQuery?.(event.statement.text);
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(NestOwner, entity => {
            entity.toTable('nest_owners');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(NestTag, entity => {
            entity.toTable('nest_tags');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(NestPrincipal, entity => {
            entity.toTable('nest_principals');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.ownerId)
                .hasColumnName('owner_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(NestOwner, row => row.owner)
                .withMany(row => row.principals)
                .hasForeignKey(row => row.ownerId);
            entity.hasManyToMany(NestTag, row => row.tags)
                .withMany(row => row.principals)
                .usingJoinTable('nest_principal_tags', join => {
                    join.sourceForeignKey('principal_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(NestDependent, entity => {
            entity.toTable('nest_dependents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.principalId)
                .hasColumnName('principal_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(NestPrincipal, row => row.principal)
                .withMany(row => row.dependents)
                .hasForeignKey(row => row.principalId)
                .onDelete(DeleteBehavior.Cascade);
        });
    }
}

/** One owner over two principals with one dependent each, plus a shared tag. */
export async function openNestedIncludeGraph(): Promise<NestedIncludeContext> {
    const db = NestedIncludeContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    for (const statement of [
        { text: 'insert into nest_owners (id) values (?)', values: ['o1'] },
        { text: 'insert into nest_tags (id) values (?)', values: ['tag1'] },
        {
            text: `insert into nest_principals (id, owner_id)
                values (?, ?), (?, ?)`,
            values: ['p1', 'o1', 'p2', 'o1'],
        },
        {
            text: `insert into nest_dependents (id, principal_id)
                values (?, ?), (?, ?)`,
            values: ['d1', 'p1', 'd2', 'p2'],
        },
        {
            text: `insert into nest_principal_tags (principal_id, tag_id)
                values (?, ?), (?, ?)`,
            values: ['p1', 'tag1', 'p2', 'tag1'],
        },
    ]) {
        await db.database.connection.query(statement);
    }
    return db;
}

/** Read the dependent table directly, in a stable order. */
export async function storedDependentIds(
    db: NestedIncludeContext,
): Promise<string[]> {
    const result = await db.database.connection.query<{ id: string }>({
        text: 'select id from nest_dependents order by id', values: [],
    });
    return result.rows.map(row => row.id);
}

/** Read the join table directly, as `principal->tag` pairs in a stable order. */
export async function storedJoinRows(
    db: NestedIncludeContext,
): Promise<string[]> {
    const result = await db.database.connection.query<{
        principal_id: string; tag_id: string;
    }>({
        text: `select principal_id, tag_id from nest_principal_tags
            order by principal_id, tag_id`,
        values: [],
    });
    return result.rows.map(row => `${row.principal_id}->${row.tag_id}`);
}

/** Refuse exactly the numbered write of one navigation, accepting the rest. */
export function refuseNavigationWrite(
    owner: object,
    property: string,
    refuseAt: number,
    boom: Error,
): void {
    let writes = 0;
    let stored: unknown = (owner as Record<string, unknown>)[property];
    Object.defineProperty(owner, property, {
        configurable: true,
        enumerable: true,
        get: (): unknown => stored,
        set: (value: unknown): void => {
            writes += 1;
            if (writes === refuseAt) throw boom;
            stored = value;
        },
    });
}
