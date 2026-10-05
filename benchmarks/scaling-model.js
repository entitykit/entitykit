const { DbContext, DeleteBehavior } = require('@entitykit/core');
const { parameter } = require('./direct-driver');

class ScalingParent { scope = 1; id = 0; children = []; tags = []; }
class ScalingChild { id = 0; scope = 1; parentId = 0; score = 0; parent = null; }
class ScalingTag { id = 0; score = 0; workspaceId = 1; parents = []; windowParents = []; }
class WindowParent { id = 0; children = []; tags = []; }
class WindowChild { id = 0; parentId = 0; score = 0; workspaceId = 1; parent = null; }
class ScalingRecord { id = 0; payload = { nested: { label: 'original' } }; category = 'generated'; }
class ScalingNode { id = 0; parentId = null; parent = null; children = []; }

class ScalingContext extends DbContext {
  parents = this.set(ScalingParent);
  windowParents = this.set(WindowParent);
  children = this.set(ScalingChild);
  records = this.set(ScalingRecord);
  nodes = this.set(ScalingNode);
  constructor(source, counters) { super(); this.source = source; this.counters = counters; }
  configure(options) {
    options.useDataSource(this.source).useTenantScope(() => 1).useDiagnostics(event => {
      if (event.kind === 'query') {
        this.counters.queries += 1;
        this.counters.maxParameters = Math.max(this.counters.maxParameters, event.statement.values.length);
      }
    });
  }
  model(model) {
    model.entity(ScalingParent, entity => {
      entity.toTable('entitykit_scaling_parents').hasKey(row => [row.scope, row.id]);
      for (const property of ['scope', 'id']) entity.property(property).hasColumnType('integer').isRequired();
      entity.hasManyToMany(ScalingTag, row => row.tags).withMany(row => row.parents)
        .usingJoinTable('entitykit_scaling_links', join => {
          join.sourceForeignKey(['scope', 'parent_id']); join.targetForeignKey('tag_id');
        });
    });
    model.entity(ScalingChild, entity => {
      entity.toTable('entitykit_scaling_children').hasKey(row => row.id);
      for (const property of ['id', 'scope', 'parentId', 'score']) entity.property(property).hasColumnName(property === 'parentId' ? 'parent_id' : property).hasColumnType('integer').isRequired();
      entity.hasOne(ScalingParent, row => row.parent).withMany(row => row.children)
        .hasForeignKey(row => [row.scope, row.parentId]);
    });
    model.entity(ScalingTag, entity => {
      entity.toTable('entitykit_scaling_tags').hasKey(row => row.id).tenantKey(row => row.workspaceId);
      for (const property of ['id', 'score', 'workspaceId']) entity.property(property).hasColumnName(property === 'workspaceId' ? 'workspace_id' : property).hasColumnType('integer').isRequired();
    });
    model.entity(WindowParent, entity => {
      entity.toTable('entitykit_scaling_window_parents').hasKey(row => row.id);
      entity.property(row => row.id).hasColumnType('integer').isRequired();
      entity.hasManyToMany(ScalingTag, row => row.tags).withMany(row => row.windowParents)
        .usingJoinTable('entitykit_scaling_window_links', join => {
          join.sourceForeignKey('parent_id'); join.targetForeignKey('tag_id');
        });
    });
    model.entity(WindowChild, entity => {
      entity.toTable('entitykit_scaling_window_children').hasKey(row => row.id).tenantKey(row => row.workspaceId);
      for (const property of ['id', 'parentId', 'score', 'workspaceId']) entity.property(property)
        .hasColumnName(property === 'parentId' ? 'parent_id' : property === 'workspaceId' ? 'workspace_id' : property).hasColumnType('integer').isRequired();
      entity.hasOne(WindowParent, row => row.parent).withMany(row => row.children).hasForeignKey(row => row.parentId);
    });
    model.entity(ScalingRecord, entity => {
      entity.toTable('entitykit_scaling_records').hasKey(row => row.id);
      const key = entity.property(row => row.id).hasColumnType('integer').isRequired();
      if (this.source.providerName === 'postgres') key.useIdentityColumn();
      else if (this.source.providerName === 'mysql') key.useAutoIncrement();
      else key.useSqliteRowId();
      entity.property(row => row.payload).hasColumnType('text').isRequired().hasConversion({
        toProvider: value => JSON.stringify(value), fromProvider: value => JSON.parse(value),
      });
      entity.property(row => row.category).hasColumnType('varchar(64)').isRequired();
    });
    model.entity(ScalingNode, entity => {
      entity.toTable('entitykit_scaling_nodes').hasKey(row => row.id);
      entity.property(row => row.id).hasColumnType('integer').isRequired();
      entity.property(row => row.parentId).hasColumnName('parent_id').hasColumnType('integer');
      entity.hasOne(ScalingNode, row => row.parent).withMany(row => row.children)
        .hasForeignKey(row => row.parentId).onDelete(DeleteBehavior.Cascade);
    });
  }
}

async function withScalingContext(source, counters, work) {
  const db = ScalingContext.create(source, counters);
  try { return await work(db); } finally { await db.dispose(); }
}

const tables = ['window_links', 'window_children', 'window_parents', 'links', 'children', 'tags', 'parents', 'records', 'nodes'];
async function dropScalingTables(raw) {
  for (const table of tables) await raw.query(`drop table if exists entitykit_scaling_${table}`);
}

async function insertRows(raw, provider, table, columns, rows) {
  for (let start = 0; start < rows.length; start += 100) {
    const chunk = rows.slice(start, start + 100);
    const values = chunk.flat();
    const tuples = chunk.map((row, offset) => `(${row.map((value, index) => parameter(provider, offset * columns.length + index + 1)).join(', ')})`);
    await raw.query(`insert into entitykit_scaling_${table} (${columns.join(', ')}) values ${tuples.join(', ')}`, values);
  }
}

async function seedScalingGraph(raw, provider, source, counters) {
  await dropScalingTables(raw);
  await withScalingContext(source, counters, db => db.database.ensureCreated());
  const parents = Array.from({ length: 1_024 }, (_, index) => [1, index + 1]);
  const children = parents.flatMap(([scope, id]) => Array.from({ length: 4 }, (_, score) => [(id - 1) * 4 + score + 1, scope, id, score]));
  children.push(...Array.from({ length: 1_000 }, (_, index) => [100_000 + index, 1, 1, index]));
  await insertRows(raw, provider, 'parents', ['scope', 'id'], parents);
  await insertRows(raw, provider, 'children', ['id', 'scope', 'parent_id', 'score'], children);
  await insertRows(raw, provider, 'tags', ['id', 'score', 'workspace_id'], Array.from({ length: 5 }, (_, score) => [score + 1, score % 4, score === 4 ? 2 : 1]));
  await insertRows(raw, provider, 'links', ['scope', 'parent_id', 'tag_id'], parents.flatMap(([scope, id]) => [1, 2, 3, 4, 5].map(tag => [scope, id, tag])));
  await insertRows(raw, provider, 'window_parents', ['id'], parents.slice(0, 33).map(([, id]) => [id]));
  await insertRows(raw, provider, 'window_children', ['id', 'parent_id', 'score', 'workspace_id'], parents.slice(0, 33)
    .flatMap(([, id]) => Array.from({ length: 4 }, (_, score) => [(id - 1) * 4 + score + 1, id, score, 1])));
  await insertRows(raw, provider, 'window_links', ['parent_id', 'tag_id'], parents.slice(0, 33).flatMap(([, id]) => [1, 2, 3, 4, 5].map(tag => [id, tag])));
  await insertRows(raw, provider, 'nodes', ['id', 'parent_id'], Array.from({ length: 400 }, (_, index) => [index + 1, index === 0 ? null : index]));
  await withScalingContext(source, counters, async db => {
    for (let index = 0; index < 1_000; index += 1) db.records.add(new ScalingRecord());
    await db.saveChanges();
  });
}

module.exports = { ScalingContext, ScalingRecord, withScalingContext, seedScalingGraph, dropScalingTables };
