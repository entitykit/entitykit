/** Whether a Postgres commit transport error leaves durability unknowable. */
export function isUnknownPostgresCommitOutcome(code?: string): boolean {
    return code !== undefined && (
        code.startsWith('08') ||
        [
            '57P01',
            '57P02',
            '57P03',
            'ECONNREFUSED',
            'ECONNRESET',
            'EPIPE',
            'ETIMEDOUT',
        ].includes(code)
    );
}
