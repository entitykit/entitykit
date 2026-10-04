const assert = require('node:assert/strict');
const { findTransactionOutcomeUnknown } = require('@entitykit/core/adapter');
const { BookshopStore, openBookshop } = require('../examples/bookshop/dist/bookshop-store');
const { resetShop, shopSnapshot } = require('../examples/bookshop/dist/qualification-fixture');
const { checkout } = require('../examples/bookshop/dist/checkout');
const { qualificationSource, within } = require('./provider-qualification');
const { commitAcknowledgmentProxy } = require('./commit-acknowledgment-proxy');

async function qualifyLostCommitAcknowledgment(provider, target) {
  const direct = openBookshop(provider, target);
  const proxy = await commitAcknowledgmentProxy(provider, target);
  let decisions = 0;
  const source = qualificationSource(provider, proxy.target, 1, { retry: {
    maxAttempts: 3, initialDelayMs: 0, shouldRetry: () => { decisions += 1; return true; },
  } });
  const uncertain = new BookshopStore(source);
  const command = { requestId: 'lost-commit-ack', sku: 'typescript-book', quantity: 2 };
  try {
    await resetShop(direct);
    proxy.arm();
    let failure;
    try { await within(checkout(uncertain, 'north-shop', 'buyer', command)); }
    catch (error) { failure = error; }
    assert.ok(failure, 'The client must refuse to report success without the commit acknowledgment.');
    const unknown = findTransactionOutcomeUnknown(failure);
    assert.ok(unknown, 'A lost acknowledgment must preserve the unknown-outcome classification through rollback cleanup.');
    assert.equal(unknown.provider, provider);
    assert.equal(unknown.retryable, false);
    assert.equal(decisions, 0, 'Unknown outcomes must bypass even an always-retry policy.');
    assert.equal(proxy.state.dropped, 1, 'The proxy must have observed an actual successful server commit response.');
    assert.equal(proxy.state.error, undefined);
    await uncertain.dispose();
    await proxy.close();

    // A fresh direct application connection reads the durable command receipt.
    const replay = await checkout(direct, 'north-shop', 'buyer', command);
    assert.deepEqual(await checkout(direct, 'north-shop', 'buyer', command), replay);
    assert.deepEqual(await shopSnapshot(direct), { available: 3, version: 2, orders: 1, audit: 1, receipts: 1, outbox: 1 });
    const other = await shopSnapshot(direct, 'south-shop');
    // The delivery queue is deliberately global; its payload carries tenancy.
    assert.deepEqual(other, { available: 7, version: 1, orders: 0, audit: 0, receipts: 0, outbox: 1 });
    console.log(`PROVIDER_LOST_COMMIT_ACK_DURABLE_RECEIPT_REPLAY_OK ${provider}`);
  } finally {
    await uncertain.dispose();
    await proxy.close();
    await direct.dispose();
  }
}

module.exports = { qualifyLostCommitAcknowledgment };
