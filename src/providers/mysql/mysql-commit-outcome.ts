/** Whether a MySQL commit transport error leaves durability unknowable. */
export function isUnknownMysqlCommitOutcome(code?: string): boolean {
    return code !== undefined && [
        'ER_SERVER_SHUTDOWN',
        'PROTOCOL_CONNECTION_LOST',
        'ECONNRESET',
        'ECONNREFUSED',
        'EPIPE',
        'ETIMEDOUT',
    ].includes(code);
}
