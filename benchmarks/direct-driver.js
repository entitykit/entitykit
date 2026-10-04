function parameter(provider, index) { return provider === 'postgres' ? `$${index}` : '?'; }

function directDriver(provider, target, counters) {
  if (provider === 'sqlite') {
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(target);
    return {
      async query(text, values = []) {
        counters.queries += 1;
        counters.maxParameters = Math.max(counters.maxParameters, values.length);
        const prepared = database.prepare(text);
        return /^select/iu.test(text) ? prepared.all(...values) : prepared.run(...values);
      },
      async dispose() { database.close(); },
    };
  }
  const pool = provider === 'postgres' ? new (require('pg').Pool)({ connectionString: target, max: 4 })
    : require('mysql2/promise').createPool({ uri: target, connectionLimit: 4, timezone: 'Z' });
  return {
    async query(text, values = []) {
      counters.queries += 1;
      counters.maxParameters = Math.max(counters.maxParameters, values.length);
      const result = await pool.query(text, values);
      return provider === 'postgres' ? result.rows : result[0];
    },
    async dispose() { await pool.end(); },
  };
}

async function seedWorkload(raw, provider, rows) {
  for (let first = 1; first <= rows; first += 100) {
    const values = [];
    const tuples = Array.from({ length: Math.min(100, rows - first + 1) }, (_, offset) => {
      const id = first + offset;
      values.push(id, `record-${id}-`.padEnd(192, 'x'), 1);
      return `(${[1, 2, 3].map(index => parameter(provider, offset * 3 + index)).join(', ')})`;
    });
    await raw.query(`insert into entitykit_benchmark_records (id, value, version) values ${tuples.join(', ')}`, values);
  }
  for (let id = 1; id <= 32; id += 1) {
    await raw.query(`insert into entitykit_benchmark_notes (id, record_id, value) values (${[1, 2, 3].map(index => parameter(provider, index)).join(', ')})`,
      [id, Math.ceil(id / 2), 'paired split include']);
  }
}

module.exports = { parameter, directDriver, seedWorkload };
