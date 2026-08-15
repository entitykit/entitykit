import {
    writeVerifiedNavigation,
} from '../src/tracking/verified-navigation-write';

class Principal {
    public id = '';
}

class Dependent {
    public principal: Principal | null = null;
    public items: Principal[] = [];
}

function defineNavigation(
    entity: object,
    name: string,
    store: (value: unknown) => unknown,
): void {
    let stored: unknown;
    Object.defineProperty(entity, name, {
        configurable: true,
        get: () => stored,
        set: (value: unknown) => {
            stored = store(value);
        },
    });
}

describe('writeVerifiedNavigation', () => {
    it('returns the stored reference when the accessor accepts it', () => {
        const dependent = new Dependent();
        const principal = Object.assign(new Principal(), { id: 'p1' });

        expect(writeVerifiedNavigation(
            dependent, 'principal', principal, 'Dependent',
        )).toBe(principal);
    });

    it('accepts a null reference assignment', () => {
        const dependent = new Dependent();
        dependent.principal = Object.assign(new Principal(), { id: 'p1' });

        expect(writeVerifiedNavigation(
            dependent, 'principal', null, 'Dependent',
        )).toBeNull();
    });

    it('rejects an accessor that silently refuses a reference', () => {
        const dependent = new Dependent();
        const kept = Object.assign(new Principal(), { id: 'p0' });
        defineNavigation(dependent, 'principal', () => kept);

        expect(() => writeVerifiedNavigation(
            dependent,
            'principal',
            Object.assign(new Principal(), { id: 'p1' }),
            'Dependent',
        )).toThrow(
            'Navigation \'Dependent.principal\' refused its assigned value.',
        );
    });

    it('rejects a structurally identical clone of the assigned entity', () => {
        const dependent = new Dependent();
        const principal = Object.assign(new Principal(), { id: 'p1' });
        defineNavigation(dependent, 'principal', value =>
            Object.assign(new Principal(), value));

        expect(() => writeVerifiedNavigation(
            dependent, 'principal', principal, 'Dependent',
        )).toThrow(
            'Navigation \'Dependent.principal\' refused its assigned value.',
        );
    });

    it('accepts a different array object holding the same items in order', () => {
        const dependent = new Dependent();
        const first = Object.assign(new Principal(), { id: 'p1' });
        const second = Object.assign(new Principal(), { id: 'p2' });
        defineNavigation(dependent, 'items', value => [...value as object[]]);

        const requested = [first, second];
        const stored = writeVerifiedNavigation(
            dependent, 'items', requested, 'Dependent',
        );

        expect(stored).not.toBe(requested);
        expect(stored).toEqual([first, second]);
    });

    it('rejects a collection whose items were replaced by clones', () => {
        const dependent = new Dependent();
        const principal = Object.assign(new Principal(), { id: 'p1' });
        defineNavigation(dependent, 'items', value =>
            (value as Principal[]).map(item =>
                Object.assign(new Principal(), item)));

        expect(() => writeVerifiedNavigation(
            dependent, 'items', [principal], 'Dependent',
        )).toThrow(
            'Navigation \'Dependent.items\' refused its assigned value.',
        );
    });

    it('rejects a collection stored in a different order', () => {
        const dependent = new Dependent();
        const first = Object.assign(new Principal(), { id: 'p1' });
        const second = Object.assign(new Principal(), { id: 'p2' });
        defineNavigation(dependent, 'items', value =>
            [...value as object[]].reverse());

        expect(() => writeVerifiedNavigation(
            dependent, 'items', [first, second], 'Dependent',
        )).toThrow(
            'Navigation \'Dependent.items\' refused its assigned value.',
        );
    });

    it('rejects a collection that the accessor mutates in place', () => {
        const dependent = new Dependent();
        const first = Object.assign(new Principal(), { id: 'p1' });
        defineNavigation(dependent, 'items', value => {
            (value as Principal[]).push(new Principal());
            return value;
        });

        expect(() => writeVerifiedNavigation(
            dependent, 'items', [first], 'Dependent',
        )).toThrow(
            'Navigation \'Dependent.items\' refused its assigned value.',
        );
    });

    it('rejects a collection replaced by an empty one', () => {
        const dependent = new Dependent();
        defineNavigation(dependent, 'items', () => []);

        expect(() => writeVerifiedNavigation(
            dependent,
            'items',
            [Object.assign(new Principal(), { id: 'p1' })],
            'Dependent',
        )).toThrow(
            'Navigation \'Dependent.items\' refused its assigned value.',
        );
    });
});
