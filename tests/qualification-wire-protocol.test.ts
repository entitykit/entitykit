import { createRequire } from 'node:module';

interface WirePacket { readonly type?: number; readonly payload: Buffer; }
interface WireProtocol {
    readonly QualificationWireReader: new (provider: string, startup?: boolean) => { push(chunk: Buffer): WirePacket[] };
    readonly isCommitRequest: (provider: string, packet: WirePacket) => boolean;
    readonly isCommitCompletion: (provider: string, packet: WirePacket) => boolean;
}
const { QualificationWireReader, isCommitRequest, isCommitCompletion } =
    createRequire(__filename)('../scripts/qualification-wire-protocol') as WireProtocol;

function postgresPacket(type: string, text: string): Buffer {
    const payload = Buffer.from(text);
    const packet = Buffer.alloc(payload.length + 5);
    packet[0] = type.charCodeAt(0);
    packet.writeUInt32BE(payload.length + 4, 1);
    payload.copy(packet, 5);
    return packet;
}

function mysqlPacket(payload: Buffer): Buffer {
    const packet = Buffer.alloc(payload.length + 4);
    packet.writeUIntLE(payload.length, 0, 3);
    payload.copy(packet, 4);
    return packet;
}

describe('lost-acknowledgment qualification protocol boundaries', () => {
    it('recognizes a Postgres COMMIT across every possible TCP split after startup', () => {
        const startup = Buffer.alloc(8);
        startup.writeUInt32BE(8);
        startup.writeUInt32BE(196608, 4);
        const bytes = Buffer.concat([startup, postgresPacket('Q', 'COMMIT\0')]);
        for (let split = 1; split < bytes.length; split += 1) {
            const reader = new QualificationWireReader('postgres', true);
            const packets = [...reader.push(bytes.subarray(0, split)), ...reader.push(bytes.subarray(split))];
            expect(packets).toHaveLength(1);
            expect(isCommitRequest('postgres', packets[0])).toBe(true);
        }
    });

    it.each([Buffer.from('\x03commit'), Buffer.from('\x03\x00\x01commit')])(
        'recognizes MySQL COMMIT with and without negotiated zero query attributes', payload => {
            const bytes = mysqlPacket(payload);
            for (let split = 1; split < bytes.length; split += 1) {
                const reader = new QualificationWireReader('mysql');
                const packets = [...reader.push(bytes.subarray(0, split)), ...reader.push(bytes.subarray(split))];
                expect(packets).toHaveLength(1);
                expect(isCommitRequest('mysql', packets[0])).toBe(true);
            }
        },
    );

    it('distinguishes statements mentioning commit and rollback responses from successful commit', () => {
        const reader = new QualificationWireReader('postgres');
        const packets = reader.push(Buffer.concat([postgresPacket('Q', 'select \'commit\'\0'),
            postgresPacket('C', 'ROLLBACK\0'), postgresPacket('C', 'COMMIT\0')]));
        expect(isCommitRequest('postgres', packets[0])).toBe(false);
        expect(isCommitCompletion('postgres', packets[1])).toBe(false);
        expect(isCommitCompletion('postgres', packets[2])).toBe(true);
        expect(isCommitRequest('mysql', { payload: Buffer.from('\x03select \'commit\'') })).toBe(false);
        expect(isCommitRequest('mysql', { payload: Buffer.from('\x02commit') })).toBe(false);
        expect(isCommitCompletion('mysql', { payload: Buffer.from([255, 1, 2, 3, 4, 5, 6]) })).toBe(false);
        expect(isCommitCompletion('mysql', { payload: Buffer.from([0, 0, 0, 2, 0, 0, 0]) })).toBe(true);
    });

    it('refuses malformed and oversized packets instead of misclassifying a commit', () => {
        const malformed = Buffer.alloc(5);
        malformed.writeUInt32BE(1, 1);
        expect(() => new QualificationWireReader('postgres').push(malformed)).toThrow('Invalid');
        malformed.writeUInt32BE(17 * 1024 * 1024, 1);
        expect(() => new QualificationWireReader('postgres').push(malformed)).toThrow('Invalid');
    });
});
