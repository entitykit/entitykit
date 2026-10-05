import { cascadeGraphHasDynamicAccessors } from '../packages/core/src/tracking/cascade-graph-stability';
import { createRelationshipDb, RequiredPost, User } from './support/relationship-model';
import { contextModel, internalChangeTracker } from './support/public-api-internals';
import type { EntityEntry } from '../packages/core/src/tracking/entity-entry';
import type { Model } from '../packages/core/src/model/model';
import type { TrackedRelationshipMetadata } from '../packages/core/src/tracking/tracked-relationship-metadata';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import { EntityState } from '../packages/core/src/tracking/entity-state';

function fixture(): { parent: User; post: RequiredPost; entries: ReadonlyArray<EntityEntry<object>>; model: Model } {
    const db = createRelationshipDb();
    const parent = new User({ id: 'parent' });
    const post = new RequiredPost({ id: 'post', authorId: parent.id, author: parent });
    db.users.attach(parent); db.requiredPosts.attach(post);
    const entries = internalChangeTracker(db.changeTracker).entries();
    return { parent, post, entries, model: contextModel(db) };
}

describe('cascade graph stability', () => {
    it('accepts ordinary data properties and empty tracked graphs', () => {
        const { entries, model } = fixture();
        expect(cascadeGraphHasDynamicAccessors(entries, model)).toBe(false);
        expect(cascadeGraphHasDynamicAccessors([], model)).toBe(false);
    });
    it('ignores extra navigation-looking accessors when the mapping has no relationships', () => {
        const model = new ModelBuilder().entity(User, entity => {
            entity.toTable('isolated_users');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        }).build();
        const parent = new User({ id: 'parent' });
        const tracker = new ChangeTracker();
        tracker.track(parent, model.getEntity(User), EntityState.Unchanged);
        const get = jest.fn(() => []);
        Object.defineProperty(parent, 'cascadePosts', { get });
        expect(cascadeGraphHasDynamicAccessors(tracker.entries(), model)).toBe(false);
        expect(get).not.toHaveBeenCalled();
    });

    it.each(['author', 'authorId'])('detects a %s accessor without invoking it', property => {
        const { post, entries, model } = fixture();
        const get = jest.fn(() => undefined);
        Object.defineProperty(post, property, { get });
        expect(cascadeGraphHasDynamicAccessors(entries, model)).toBe(true);
        expect(get).not.toHaveBeenCalled();
    });

    it('detects setter-only accessors', () => {
        const { post, entries, model } = fixture();
        const set = jest.fn();
        Object.defineProperty(post, 'author', { set });
        expect(cascadeGraphHasDynamicAccessors(entries, model)).toBe(true);
        expect(set).not.toHaveBeenCalled();
    });

    it('checks inverse navigation accessors on principals', () => {
        const { parent, entries, model } = fixture();
        const relationship = model.getEntity(RequiredPost).relationships[0] as unknown as TrackedRelationshipMetadata;
        const property = relationship.inverseNavigationProperty;
        if (!property) throw new Error('Missing fixture inverse');
        const get = jest.fn(() => []);
        Object.defineProperty(parent, property, { get });
        expect(cascadeGraphHasDynamicAccessors(entries, model)).toBe(true);
        expect(get).not.toHaveBeenCalled();
    });

    it.each([true, false])('respects prototype accessors and data-property shadowing (shadowed=%s)', shadowed => {
        const { post, entries, model } = fixture();
        const get = jest.fn(() => undefined);
        Object.setPrototypeOf(post, Object.create(Object.getPrototypeOf(post) as object, { author: { get } }) as object);
        if (!shadowed) Reflect.deleteProperty(post, 'author');
        expect(cascadeGraphHasDynamicAccessors(entries, model)).toBe(!shadowed);
        expect(get).not.toHaveBeenCalled();
    });

    it('ignores accessors unrelated to relationship writes', () => {
        const { post, entries, model } = fixture();
        const get = jest.fn(() => 'title');
        Object.defineProperty(post, 'title', { get });
        expect(cascadeGraphHasDynamicAccessors(entries, model)).toBe(false);
        expect(get).not.toHaveBeenCalled();
    });

    it('detects entity proxies without executing their traps', () => {
        const { post, entries, model } = fixture();
        const getOwnPropertyDescriptor = jest.fn((target: object, property: PropertyKey): PropertyDescriptor | undefined => Reflect.getOwnPropertyDescriptor(target, property));
        const getPrototypeOf = jest.fn((target: object): object | null => Reflect.getPrototypeOf(target));
        const proxy = new Proxy(post, { getOwnPropertyDescriptor, getPrototypeOf });
        const owner = entries.find(entry => entry.entity === post);
        if (!owner) throw new Error('Missing fixture owner');
        const proxied = { entity: proxy, metadata: owner.metadata } as unknown as EntityEntry<object>;
        expect(cascadeGraphHasDynamicAccessors([proxied], model)).toBe(true);
        expect(getOwnPropertyDescriptor).not.toHaveBeenCalled();
        expect(getPrototypeOf).not.toHaveBeenCalled();
    });

    it('detects prototype proxies without executing their traps', () => {
        const { post, entries, model } = fixture();
        const getOwnPropertyDescriptor = jest.fn((target: object, property: PropertyKey): PropertyDescriptor | undefined => Reflect.getOwnPropertyDescriptor(target, property));
        const getPrototypeOf = jest.fn((target: object): object | null => Reflect.getPrototypeOf(target));
        Object.setPrototypeOf(post, new Proxy(Object.getPrototypeOf(post) as object, { getOwnPropertyDescriptor, getPrototypeOf }));
        Reflect.deleteProperty(post, 'author');
        expect(cascadeGraphHasDynamicAccessors(entries, model)).toBe(true);
        expect(getOwnPropertyDescriptor).not.toHaveBeenCalled();
        expect(getPrototypeOf).not.toHaveBeenCalled();
    });

    it('walks missing properties to the end of the prototype chain', () => {
        const { post, entries, model } = fixture();
        Reflect.deleteProperty(post, 'author');
        expect(cascadeGraphHasDynamicAccessors(entries, model)).toBe(false);
    });

    it.each(['proxy', 'filter', 'iterator', 'index', 'prototype'])('detects a dynamic %s collection without invoking hooks', kind => {
        const { parent, post, entries, model } = fixture();
        const inverse = model.getEntity(RequiredPost).relationships[0].inverseNavigationProperty as unknown;
        if (typeof inverse !== 'string') throw new Error('Missing fixture inverse');
        let collection = [post];
        const hook = jest.fn<never, unknown[]>(() => {
            throw new Error('Preflight invoked a collection hook.');
        });
        if (kind === 'proxy') {
            collection = new Proxy<RequiredPost[]>(collection, { get: hook, getOwnPropertyDescriptor: hook, ownKeys: hook, getPrototypeOf: hook });
        } else if (kind === 'prototype') {
            Object.setPrototypeOf(collection, Object.create(Array.prototype, { filter: { get: hook } }) as object);
        } else {
            const property = kind === 'iterator' ? Symbol.iterator : kind === 'index' ? '0' : 'filter';
            Object.defineProperty(collection, property, { get: hook });
        }
        Object.defineProperty(parent, inverse, { value: collection });
        expect(cascadeGraphHasDynamicAccessors(entries, model)).toBe(true);
        expect(hook).not.toHaveBeenCalled();
    });

    it('keeps ordinary arrays with duplicate entries and holes on the indexed path', () => {
        const { parent, post, entries, model } = fixture();
        const inverse = model.getEntity(RequiredPost).relationships[0].inverseNavigationProperty as unknown;
        if (typeof inverse !== 'string') throw new Error('Missing fixture inverse');
        const collection = [post, post];
        collection.length = 3;
        Object.defineProperty(parent, inverse, { value: collection });
        expect(cascadeGraphHasDynamicAccessors(entries, model)).toBe(false);
    });
});
