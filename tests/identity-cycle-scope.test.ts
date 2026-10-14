import { encodeIdentityTuple } from '../packages/core/src/model/identity-value';

describe('identity cycle scope ownership', () => {
    it('releases a failed branch before a custom array mapper retries it', () => {
        let reads = 0;
        const child = {
            get id(): number {
                if (++reads === 1) throw new Error('first read failed');
                return 7;
            },
        };
        const values: unknown[] = [child];
        Object.defineProperty(values, 'map', {
            value: (encode: (value: unknown) => unknown): unknown[] => {
                expect(() => encode(child)).toThrow('first read failed');
                return [encode(child), encode(child)];
            },
        });

        expect(encodeIdentityTuple([values])).toBe(JSON.stringify([
            'entitykit:identity:v1',
            ['array',
                ['object', ['id', ['number', '7']]],
                ['object', ['id', ['number', '7']]],
            ],
        ]));
        expect(reads).toBe(3);
    });

    it('keeps a reentrant tuple encoding independent from its caller ancestry', () => {
        let inside = false;
        let nested: string | undefined;
        let reads = 0;
        const value = {
            get id(): number {
                reads++;
                if (!inside) {
                    inside = true;
                    try {
                        nested = encodeIdentityTuple([value]);
                    } finally {
                        inside = false;
                    }
                }
                return 42;
            },
        };
        const expected = JSON.stringify([
            'entitykit:identity:v1', ['object', ['id', ['number', '42']]],
        ]);

        expect(encodeIdentityTuple([value])).toBe(expected);
        expect(nested).toBe(expected);
        expect(reads).toBe(2);
    });
});
