import { readCheckoutResult, type CheckoutResult } from './checkout-contract';

export interface OrderPlacedEvent extends CheckoutResult {
    readonly eventId: string;
}

export function readOrderPlacedEvent(serialized: string): OrderPlacedEvent {
    const response = readCheckoutResult(serialized);
    const parsed: unknown = JSON.parse(serialized);
    if (typeof parsed !== 'object' || parsed === null
        || !('eventId' in parsed) || parsed.eventId !== `${response.orderId}.placed.1`) {
        throw new Error('The order event has an invalid delivery identity.');
    }
    return { ...response, eventId: parsed.eventId };
}
