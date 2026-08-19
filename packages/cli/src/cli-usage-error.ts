/** Internal marker for invalid CLI syntax or arguments. */
export class CliUsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CliUsageError';
    }
}
