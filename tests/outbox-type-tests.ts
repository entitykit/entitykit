import type { OutboxMessage } from '../packages/core/src';

interface DomainPayload {
    readonly userId: string;
    readonly count: number;
}

const domainPayload: DomainPayload = { userId: 'usr_1', count: 1 };
const domainEvent: OutboxMessage = {
    type: 'Created',
    payload: domainPayload,
    aggregateId: 9007199254740993n,
};
void domainEvent;
