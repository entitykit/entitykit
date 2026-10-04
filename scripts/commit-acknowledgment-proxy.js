const net = require('node:net');
const { QualificationWireReader, isCommitRequest, isCommitCompletion } = require('./qualification-wire-protocol');

/** Drop one real server COMMIT acknowledgment after observing successful commit. */
async function commitAcknowledgmentProxy(provider, target) {
  const original = new URL(target);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(original.hostname)
    || [...original.searchParams.keys()].some(key => /ssl|tls/u.test(key))) {
    throw new Error('Wire qualification requires an unencrypted loopback database.');
  }
  const connections = new Set();
  let closing;
  const state = { armed: false, dropped: 0, error: undefined };
  const server = net.createServer(client => {
    const backend = net.connect({ host: original.hostname, port: Number(original.port || (provider === 'postgres' ? 5432 : 3306)) });
    connections.add(client);
    connections.add(backend);
    const requests = new QualificationWireReader(provider, provider === 'postgres');
    const responses = new QualificationWireReader(provider);
    let waitingForCommit = false;
    const destroy = () => { client.destroy(); backend.destroy(); };
    client.on('error', destroy);
    backend.on('error', destroy);
    client.on('close', () => { connections.delete(client); backend.destroy(); });
    backend.on('close', () => { connections.delete(backend); client.destroy(); });
    client.on('drain', () => backend.resume());
    backend.on('drain', () => client.resume());
    client.on('data', chunk => {
      try {
        for (const packet of requests.push(chunk)) {
          if (state.armed && isCommitRequest(provider, packet)) {
            state.armed = false;
            waitingForCommit = true;
          }
        }
        if (!backend.write(chunk)) client.pause();
      } catch (error) { state.error = error; destroy(); }
    });
    backend.on('data', chunk => {
      try {
        const packets = responses.push(chunk);
        if (waitingForCommit) {
          if (packets.some(packet => isCommitCompletion(provider, packet))) {
            state.dropped += 1;
            destroy();
          }
        } else if (!client.write(chunk)) backend.pause();
      } catch (error) { state.error = error; destroy(); }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const proxied = new URL(target);
  proxied.hostname = '127.0.0.1';
  proxied.port = String(server.address().port);
  return {
    target: proxied.toString(), state,
    arm() { state.armed = true; },
    disconnect() { for (const connection of connections) connection.destroy(); },
    async close() {
      if (closing) return closing;
      for (const connection of connections) connection.destroy();
      closing = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      return closing;
    },
  };
}

module.exports = { commitAcknowledgmentProxy };
