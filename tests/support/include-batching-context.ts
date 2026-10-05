import { DbContext, type DbContextOptionsBuilder, type ModelBuilder } from '../../packages/core/src';
import { sqliteDialect, sqliteProviderServices } from '../../packages/sqlite/src';

export class CompositeParent {
    public scope = 0;
    public id = 0;
    public children: CompositeChild[] = [];
    public labels: Label[] = [];
}
export class CompositeChild {
    public id = 0;
    public parentScope = 0;
    public parentId = 0;
    public parent: CompositeParent | null = null;
}
export class Label {
    public id = 0;
    public rank = 0;
    public parents: CompositeParent[] = [];
}
export class Parent {
    public id = 0;
    public children: Child[] = [];
    public tags: Tag[] = [];
}
export class Child {
    public id = 0;
    public parentId = 0;
    public score = 0;
    public workspaceId = 1;
    public parent: Parent | null = null;
}
export class Tag {
    public id = 0;
    public score = 0;
    public workspaceId = 1;
    public parents: Parent[] = [];
}

export class IncludeBatchingContext extends DbContext {
    public compositeParents = this.set(CompositeParent);
    public compositeChildren = this.set(CompositeChild);
    public parents = this.set(Parent);

    constructor(private readonly parameterLimit?: number) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        const limit = this.parameterLimit;
        options.useProvider(limit === undefined ? sqliteProviderServices : {
            ...sqliteProviderServices,
            dialect: { ...sqliteDialect, maxStatementParameters: () => limit },
        }, ':memory:').useTenantScope(() => 1);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(CompositeParent, entity => {
            entity.toTable('batch_composite_parents');
            entity.hasKey(row => [row.scope, row.id]);
            for (const name of ['scope', 'id'] as const) entity.property(name).hasColumnType('integer').isRequired();
            entity.hasManyToMany(Label, row => row.labels).withMany(row => row.parents)
                .usingJoinTable('batch_composite_labels', join => {
                    join.sourceForeignKey(['parent_scope', 'parent_id']);
                    join.targetForeignKey('label_id');
                });
        });
        model.entity(CompositeChild, entity => {
            entity.toTable('batch_composite_children');
            entity.hasKey(row => row.id);
            for (const name of ['id', 'parentScope', 'parentId'] as const) entity.property(name).hasColumnType('integer').isRequired();
            entity.hasOne(CompositeParent, row => row.parent).withMany(row => row.children)
                .hasForeignKey(row => [row.parentScope, row.parentId]);
        });
        model.entity(Label, entity => {
            entity.toTable('batch_labels');
            entity.hasKey(row => row.id);
            for (const name of ['id', 'rank'] as const) entity.property(name).hasColumnType('integer').isRequired();
        });
        model.entity(Parent, entity => {
            entity.toTable('batch_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.hasManyToMany(Tag, row => row.tags).withMany(row => row.parents)
                .usingJoinTable('batch_parent_tags', join => {
                    join.sourceForeignKey('parent_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(Child, entity => {
            entity.toTable('batch_children');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.workspaceId);
            for (const name of ['id', 'parentId', 'score', 'workspaceId'] as const) entity.property(name).hasColumnType('integer').isRequired();
            entity.hasOne(Parent, row => row.parent).withMany(row => row.children).hasForeignKey(row => row.parentId);
        });
        model.entity(Tag, entity => {
            entity.toTable('batch_tags');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.workspaceId);
            for (const name of ['id', 'score', 'workspaceId'] as const) entity.property(name).hasColumnType('integer').isRequired();
        });
    }
}

export async function openCompositeIncludeGraph(count: number, parameterLimit?: number): Promise<IncludeBatchingContext> {
    const db = IncludeBatchingContext.create(parameterLimit);
    await db.database.ensureCreated();
    for (const text of [
        `with recursive numbers(n) as (select 1 union all select n + 1 from numbers where n < ${String(count)})
            insert into batch_composite_parents (scope, id) select n % 2, (n + 1) / 2 from numbers`,
        `with recursive numbers(n) as (select 1 union all select n + 1 from numbers where n < ${String(count)})
            insert into batch_composite_children (id, parentScope, parentId) select n, n % 2, (n + 1) / 2 from numbers`,
        'insert into batch_labels (id, rank) values (1, 0), (2, 1)',
        'insert into batch_composite_labels (parent_scope, parent_id, label_id) select p.scope, p.id, l.id from batch_composite_parents p cross join batch_labels l',
    ]) await db.database.connection.query({ text, values: [] });
    return db;
}

export async function openWindowIncludeGraph(
    db: IncludeBatchingContext = IncludeBatchingContext.create(96),
): Promise<IncludeBatchingContext> {
    await db.database.ensureCreated();
    for (const text of [
        'with recursive numbers(n) as (select 1 union all select n + 1 from numbers where n < 33) insert into batch_parents (id) select n from numbers',
        'with recursive numbers(n) as (select 1 union all select n + 1 from numbers where n < 132) insert into batch_children (id, parentId, score, workspaceId) select n, (n - 1) / 4 + 1, (n - 1) % 4, 1 from numbers',
        'insert into batch_tags (id, score, workspaceId) values (1, 0, 1), (2, 1, 1), (3, 2, 1), (4, 3, 1), (5, 2, 2)',
        'insert into batch_parent_tags (parent_id, tag_id) select p.id, t.id from batch_parents p cross join batch_tags t',
    ]) await db.database.connection.query({ text, values: [] });
    return db;
}
