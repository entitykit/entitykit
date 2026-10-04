const assert = require('node:assert/strict');
const { openBookshop } = require('../examples/bookshop/dist/bookshop-store');
const { checkout, placeOrder } = require('../examples/bookshop/dist/checkout');
const { resetShop, shopSnapshot } = require('../examples/bookshop/dist/qualification-fixture');
const { qualificationTarget, qualificationSource, within, withConnection, statement } = require('./provider-qualification');
const { qualificationServerController } = require('./qualification-server-controller');

async function waitForRestart(provider, target) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const source = qualificationSource(provider, target);
    try {
      await within(withConnection(source, connection => connection.query(statement('select 42 as answer'))));
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 250));
    } finally { await source.dispose(); }
  }
  throw new Error('The isolated database did not recover within 20 seconds.');
}

async function main() {
  const provider = process.argv[2];
  assert.ok(['postgres', 'mysql'].includes(provider));
  const { target } = qualificationTarget(provider);
  const restart = await qualificationServerController(provider, target);
  const before = openBookshop(provider, target);
  const committed = { requestId: 'server-crash-committed', sku: 'typescript-book', quantity: 2 };
  const uncommitted = { requestId: 'server-crash-uncommitted', sku: 'typescript-book', quantity: 1 };
  let original;
  let restarted = false;
  try {
    await resetShop(before);
    original = await checkout(before, 'north-shop', 'buyer', committed);
    const db = before.context('north-shop', 'buyer');
    try {
      await assert.rejects(db.transaction(async tx => {
        await placeOrder(tx, uncommitted);
        console.log(`PROVIDER_SERVER_CRASH_WITH_UNCOMMITTED_CHECKOUT ${provider}`);
        await restart();
        restarted = true;
        throw new Error('Stop the interrupted transaction after the server restart.');
      }));
      assert.equal(restarted, true, 'Server control must complete; a failed controller is not a qualified crash.');
    } finally { await db.dispose(); }
  } finally { await before.dispose(); }

  await waitForRestart(provider, target);
  const recovered = openBookshop(provider, target);
  try {
    assert.deepEqual(await shopSnapshot(recovered), { available: 3, version: 2, orders: 1, audit: 1, receipts: 1, outbox: 1 });
    assert.deepEqual(await checkout(recovered, 'north-shop', 'buyer', committed), original);
    await checkout(recovered, 'north-shop', 'buyer', uncommitted);
    assert.deepEqual(await shopSnapshot(recovered), { available: 2, version: 3, orders: 2, audit: 2, receipts: 2, outbox: 2 });
    console.log(`PROVIDER_SERVER_CRASH_DURABLE_REPLAY_ROLLBACK_RECOVERY_OK ${provider}`);
  } finally { await recovered.dispose(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
