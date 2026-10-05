const assert = require('node:assert/strict');
const { EntityState } = require('@entitykit/core');
const { withScalingContext } = require('./scaling-model');
const { measure, budgets } = require('./workload-measurement');

async function relationshipFixupWorkloads(source, counters) {
  const results = [];
  for (const size of [250, 1_000]) {
    for (const detect of [false, true]) {
      results.push(await measure(`orm.separate-load-${detect ? 'detect-save' : 'noop-save'}-${size}`,
        counters, () => withScalingContext(source, counters, async db => {
          const parent = await db.parents.where(row => row.scope.eq(1).and(row.id.eq(1))).single();
          const children = await db.children.where(row => row.id.gte(100_000))
            .orderBy(row => row.id).take(size).toArray();
          assert.equal(children.length, size);
          assert.equal(parent.children.length, 0);
          assert.ok(children.every(child => child.parent === null));
          if (detect) db.changeTracker.detectChanges();
          const queries = counters.queries;
          assert.equal(await db.saveChanges(), 0);
          assert.equal(counters.queries, queries, 'A no-op save submitted SQL.');
          assert.ok(db.changeTracker.entries().every(entry => entry.state === EntityState.Unchanged));
          // A plan with no writes restores its temporary graph changes. An
          // explicit detectChanges() advances the baseline and keeps its graph.
          if (detect) {
            assert.deepEqual(parent.children, children);
            assert.ok(children.every(child => child.parent === parent));
          } else {
            assert.equal(parent.children.length, 0);
            assert.ok(children.every(child => child.parent === null));
          }
        }), 8, 2, budgets.batchP95Ms));
    }
  }
  return results;
}

module.exports = { relationshipFixupWorkloads };
