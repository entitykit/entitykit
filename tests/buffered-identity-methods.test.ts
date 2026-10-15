import { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { EntityKeyMetadata } from '../packages/core/src/model/entity-key-metadata';
import { bufferedIdentityScope } from './support/buffered-identity';
import type * as EntityMetadataModule from '../packages/core/src/model/entity-metadata';
import type * as BufferedIdentitySupport from './support/buffered-identity';

describe('buffered identity method guards', () => {
    it.each(['entityMethod', 'keyAccessor', 'keyMethod', 'entityGetter'])('observes constructor replacement of %s', member => {
        const prototype = member === 'keyMethod' ? EntityKeyMetadata.prototype : EntityMetadata.prototype;
        const name = member === 'keyAccessor' ? 'key' : 'createIdentityKeyFromProviderValues';
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (!descriptor) throw new Error('Expected identity method descriptor');
        let enter = false, getters = 0, calls = 0;
        const scope = bufferedIdentityScope(true, () => {
            if (!enter) return;
            enter = false;
            const encode = descriptor.value as (values: readonly unknown[]) => string;
            function changed(this: object, ...args: unknown[]): string {
                calls++;return (Reflect.apply(encode, this, args) as string) + ':changed';
            }
            if (member === 'keyAccessor') {
                const key = descriptor.value as () => EntityKeyMetadata<object>;
                Object.defineProperty(prototype, name, { ...descriptor, value: function (this: object) {
                    const original = Reflect.apply(key, this, []);
                    return { createIdentityKeyFromProviderValues: (values: readonly unknown[]) => {
                        calls++;return original.createIdentityKeyFromProviderValues(values) + ':changed';
                    } };
                } });
            } else if (member === 'entityGetter') {
                Object.defineProperty(prototype, name, { configurable: true, get: () => {
                    getters++;return changed;
                } });
            } else Object.defineProperty(prototype, name, { ...descriptor, value: changed });
        });
        try {
            scope.read(1);enter = true;
            const row = scope.read(2).entity;
            expect(calls).toBe(1);expect(getters).toBe(member === 'entityGetter' ? 1 : 0);
            expect(scope.identities.get(scope.metadata, { id: 2 })).toBe(row);
            expect(calls).toBe(2);
            Object.defineProperty(prototype, name, descriptor);
            expect(scope.identities.get(scope.metadata, { id: 2 })).toBeUndefined();
        } finally {
            Object.defineProperty(prototype, name, descriptor);
        }
    });

    it('observes a method replaced midway through one batch and after duplicate/clear transitions', () => {
        const prototype = EntityMetadata.prototype, name = 'createIdentityKeyFromProviderValues';
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (!descriptor) throw new Error('Expected identity method descriptor');
        const original = descriptor.value as (values: readonly unknown[]) => string;
        let constructed = 0, calls = 0;
        const scope = bufferedIdentityScope(true, () => {
            if (++constructed === 2) Object.defineProperty(prototype, name, { ...descriptor, value: function (this: object, ...args: unknown[]) {
                calls++;return (Reflect.apply(original, this, args) as string) + ':late';
            } });
        });
        try {
            const roots = scope.materializer.materializeManyWithValues(scope.metadata,
                [{ id: 1, name: 'one' }, { id: 2, name: 'two' }, { id: 3, name: 'three' }], scope.tracker);
            expect(calls).toBe(3);
            expect(scope.read(2).entity).toBe(roots[1].entity);
            scope.identities.clear();
            expect(scope.read(2).entity).not.toBe(roots[1].entity);
            expect(calls).toBe(5);
        } finally {
            Object.defineProperty(prototype, name, descriptor);
        }
    });

    it('does not trust a method replaced before the receipt module is imported', () => {
        jest.isolateModules(() => {
            const metadataModule: typeof EntityMetadataModule = jest.requireActual('../packages/core/src/model/entity-metadata');
            const prototype = metadataModule.EntityMetadata.prototype;
            const original = Object.getOwnPropertyDescriptor(prototype, 'createIdentityKeyFromProviderValues')?.value as (this: object, values: readonly unknown[]) => string;
            let calls = 0;
            prototype.createIdentityKeyFromProviderValues = function (values): string {
                calls++;return original.call(this, values);
            };
            try {
                const support: typeof BufferedIdentitySupport = jest.requireActual('./support/buffered-identity');
                const scope = support.bufferedIdentityScope();
                scope.read(1);scope.read(2);
                expect(calls).toBe(3);
            } finally {
                prototype.createIdentityKeyFromProviderValues = original;
            }
        });
    });
});
