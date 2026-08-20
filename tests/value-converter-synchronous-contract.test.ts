import type { ValueConverter } from '../packages/core/src';
import {
    fromProviderValue,
    toProviderValue,
} from '../packages/core/src/model/value-converter';
import {
    snapshotPropertyValue,
    snapshotPropertyValuesEqual,
} from '../packages/core/src/tracking/snapshot-value';

describe('value converter synchronous contract', () => {
    it('allows ordinary converted values in both directions', () => {
        const converter: ValueConverter<string, string> = {
            toProvider: value => `stored:${value}`,
            fromProvider: value => value.replace('stored:', ''),
        };

        expect(toProviderValue('value', converter)).toBe('stored:value');
        expect(fromProviderValue('stored:value', converter)).toBe('value');
    });

    it('rejects a promise returned from toProvider()', () => {
        const converter: ValueConverter<string> = {
            toProvider: async value => {
                await Promise.resolve();
                return `stored:${value}`;
            },
            fromProvider: value => String(value),
        };

        expect(() => toProviderValue('value', converter)).toThrow(
            'ValueConverter.toProvider() must be synchronous and must not return a Promise.',
        );
    });

    it('rejects a promise returned from fromProvider()', () => {
        const converter: ValueConverter = {
            toProvider: value => value,
            fromProvider: async value => {
                await Promise.resolve();
                return String(value);
            },
        };

        expect(() => fromProviderValue('stored:value', converter)).toThrow(
            'ValueConverter.fromProvider() must be synchronous and must not return a Promise.',
        );
    });

    it('detects a custom thenable returned by a converter', () => {
        const converter: ValueConverter = {
            toProvider: () => ({ then: (): void => undefined }),
            fromProvider: value => value,
        };

        expect(() => toProviderValue('value', converter)).toThrow(
            'ValueConverter.toProvider() must be synchronous',
        );
    });

    it('guards converter calls made while tracking snapshots', () => {
        const asyncWrite: ValueConverter = {
            toProvider: async () => {
                await Promise.resolve();
                return 'stored:value';
            },
            fromProvider: value => value,
        };
        const asyncRead: ValueConverter = {
            toProvider: value => value,
            fromProvider: async () => {
                await Promise.resolve();
                return 'value';
            },
        };

        expect(() => snapshotPropertyValue('value', asyncWrite)).toThrow(
            'ValueConverter.toProvider() must be synchronous',
        );
        expect(() => snapshotPropertyValue('value', asyncRead)).toThrow(
            'ValueConverter.fromProvider() must be synchronous',
        );
        expect(() => snapshotPropertyValuesEqual(
            'value',
            'value',
            asyncWrite,
        )).toThrow('ValueConverter.toProvider() must be synchronous');
    });

    it('consumes rejected converter promises', async () => {
        const unhandled: unknown[] = [];
        const observeUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        const converter: ValueConverter = {
            toProvider: async () => {
                await Promise.resolve();
                throw new Error('write conversion failed');
            },
            fromProvider: async () => {
                await Promise.resolve();
                throw new Error('read conversion failed');
            },
        };

        process.on('unhandledRejection', observeUnhandled);
        try {
            expect(() => toProviderValue('value', converter)).toThrow(
                'ValueConverter.toProvider() must be synchronous',
            );
            expect(() => fromProviderValue('stored:value', converter)).toThrow(
                'ValueConverter.fromProvider() must be synchronous',
            );
            await new Promise<void>(resolve => setImmediate(resolve));

            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', observeUnhandled);
        }
    });
});
