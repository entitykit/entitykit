import { OperationCanceledError } from '@entitykit/core';
import { isOperationAborted, throwIfOperationAborted } from '@entitykit/core/adapter';

describe('operation cancellation signal state', () => {
    it('accepts operations with no cancellation signal', () => {
        expect(isOperationAborted()).toBe(false);
        expect(() => {
            throwIfOperationAborted();
        }).not.toThrow();
    });

    it('accepts a live signal and observes its later cancellation', () => {
        const controller = new AbortController();
        expect(isOperationAborted(controller.signal)).toBe(false);
        expect(() => {
            throwIfOperationAborted(controller.signal);
        }).not.toThrow();
        const reason = new Error('deadline reached');
        controller.abort(reason);
        expect(isOperationAborted(controller.signal)).toBe(true);
        expect(() => {
            throwIfOperationAborted(controller.signal);
        }).toThrow(OperationCanceledError);
        try {
            throwIfOperationAborted(controller.signal);
        } catch (error) {
            expect(error).toHaveProperty('cause', reason);
        }
    });
});
