export interface CheckoutCommand {
    readonly requestId: string;
    readonly sku: string;
    readonly quantity: number;
}

export interface CheckoutResult {
    readonly tenantId: string;
    readonly orderId: string;
    readonly sku: string;
    readonly quantity: number;
    readonly version: number;
}

export class IdempotencyMismatchError extends Error {
    constructor() {
        super('The request ID already belongs to a different checkout command or actor.');
    }
}

export function assertIdentifier(value: string): void {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value)) {
        throw new TypeError('Identifiers must contain 1 to 64 lowercase ASCII letters, digits, dots, dashes, or underscores.');
    }
}

export function validateCommand(command: CheckoutCommand): void {
    assertIdentifier(command.requestId);
    assertIdentifier(command.sku);
    if (!Number.isSafeInteger(command.quantity) || command.quantity < 1 || command.quantity > 10_000) {
        throw new RangeError('Checkout quantity must be an integer from 1 to 10000.');
    }
}

export function readCheckoutResult(serialized: string): CheckoutResult {
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== 'object' || value === null
        || !('tenantId' in value) || typeof value.tenantId !== 'string'
        || !('orderId' in value) || typeof value.orderId !== 'string'
        || !('sku' in value) || typeof value.sku !== 'string'
        || !('quantity' in value) || typeof value.quantity !== 'number'
        || !('version' in value) || value.version !== 1) {
        throw new Error('The durable checkout receipt is invalid.');
    }
    assertIdentifier(value.tenantId);
    assertIdentifier(value.orderId);
    validateCommand({ requestId: value.orderId, sku: value.sku, quantity: value.quantity });
    return { tenantId: value.tenantId, orderId: value.orderId, sku: value.sku,
        quantity: value.quantity, version: value.version };
}
