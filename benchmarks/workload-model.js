const { DbContext } = require('@entitykit/core');

class BenchmarkRecord { id = 0; value = ''; version = 1; notes = []; }
class BenchmarkNote { id = 0; recordId = 0; value = ''; record = undefined; }

class BenchmarkContext extends DbContext {
  records = this.set(BenchmarkRecord);
  notes = this.set(BenchmarkNote);
  constructor(source, counters) { super(); this.source = source; this.counters = counters; }
  configure(options) {
    options.useDataSource(this.source).useDiagnostics(event => {
      if (event.kind === 'query') {
        this.counters.queries += 1;
        this.counters.maxParameters = Math.max(this.counters.maxParameters, event.statement.values.length);
      }
    });
  }
  model(model) {
    model.entity(BenchmarkRecord, entity => {
      entity.toTable('entitykit_benchmark_records').hasKey(row => row.id);
      entity.property(row => row.id).hasColumnType('integer').isRequired();
      entity.property(row => row.value).hasColumnType('varchar(256)').isRequired();
      entity.property(row => row.version).hasColumnType('integer').isRequired().isVersion();
    });
    model.entity(BenchmarkNote, entity => {
      entity.toTable('entitykit_benchmark_notes').hasKey(row => row.id);
      entity.property(row => row.id).hasColumnType('integer').isRequired();
      entity.property(row => row.recordId).hasColumnName('record_id').hasColumnType('integer').isRequired();
      entity.property(row => row.value).hasColumnType('varchar(256)').isRequired();
      entity.hasOne(BenchmarkRecord, row => row.record).withMany(row => row.notes).hasForeignKey(row => row.recordId);
    });
  }
}

async function withBenchmarkContext(source, counters, work) {
  const db = BenchmarkContext.create(source, counters);
  try { return await work(db); }
  finally { await db.dispose(); }
}

module.exports = { BenchmarkContext, BenchmarkRecord, withBenchmarkContext };
