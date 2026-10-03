const MAX_PACKET = 16 * 1024 * 1024;

/** Read unencrypted qualification traffic across arbitrary TCP chunk boundaries. */
class QualificationWireReader {
  constructor(provider, startup = false) {
    this.provider = provider;
    this.startup = startup;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const packets = [];
    while (true) {
      const header = this.provider === 'mysql' || this.startup ? 4 : 5;
      if (this.buffer.length < header) break;
      const length = this.provider === 'mysql' ? this.buffer.readUIntLE(0, 3) + 4
        : this.startup ? this.buffer.readUInt32BE(0) : this.buffer.readUInt32BE(1) + 1;
      if (length < header || length > MAX_PACKET) throw new Error('Invalid qualification wire packet.');
      if (this.buffer.length < length) break;
      const packet = this.buffer.subarray(0, length);
      if (!this.startup) packets.push({ type: this.provider === 'mysql' ? undefined : packet[0], payload: packet.subarray(header) });
      this.startup = false;
      this.buffer = this.buffer.subarray(length);
    }
    return packets;
  }
}

function isCommitRequest(provider, packet) {
  if (provider === 'postgres') return packet.type === 0x51 && packet.payload.toString('utf8').replace(/\0$/u, '').trim().toLowerCase() === 'commit';
  // MySQL 8's negotiated CLIENT_QUERY_ATTRIBUTES prefixes plain queries with
  // zero attributes and one parameter set. Qualification sends no attributes.
  const offset = packet.payload[1] === 0 && packet.payload[2] === 1 ? 3 : 1;
  return packet.payload[0] === 0x03 && packet.payload.subarray(offset).toString('utf8').trim().toLowerCase() === 'commit';
}

function isCommitCompletion(provider, packet) {
  if (provider === 'postgres') return packet.type === 0x43 && packet.payload.toString('utf8') === 'COMMIT\0';
  // COM_QUERY's successful COMMIT response is an OK packet, not an ERR packet.
  return packet.payload.length >= 7 && packet.payload[0] === 0;
}

module.exports = { QualificationWireReader, isCommitRequest, isCommitCompletion };
