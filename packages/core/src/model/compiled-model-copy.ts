import { types } from 'node:util';
import { Model } from './model';
import { EntityMetadata } from './entity-metadata';
import { EntityKeyMetadata } from './entity-key-metadata';
import { ModelValidationError } from '../errors/model-validation-error';
import { copyCompiledModelMap } from './compiled-model-map';

/** Own the finalized graph without freezing builders, constructors or legacy models. */
export function copyCompiledModel(
    source: Model,
    onEntityCopied?: (entity: EntityMetadata) => void,
): Model {
    const constructors: Set<unknown> = new Set(source.entities.map(entity => entity.ctor));
    const seen: Map<object, unknown> = new Map();
    const entities: EntityMetadata[] = [];
    const prototypes: readonly unknown[] = [
        null, Object.prototype, Array.prototype,
        Model.prototype, EntityMetadata.prototype, EntityKeyMetadata.prototype,
    ];
    function copy(value: unknown): unknown {
        if (typeof value === 'function') {
            if (!constructors.has(value)) throw unsupported('shared callbacks, including value converters');
            return value;
        }
        if (value === null || typeof value !== 'object') return value;
        if (types.isProxy(value)) throw unsupported('proxied metadata');
        if (seen.has(value)) return seen.get(value);
        const prototype: unknown = Object.getPrototypeOf(value);
        if (prototype === Map.prototype) {
            if (Reflect.ownKeys(value).length > 0) throw unsupported('custom lookup properties');
            return copyCompiledModelMap(value as Map<unknown, unknown>, copy, result => {
                seen.set(value, result);
            });
        }
        if (!prototypes.includes(prototype)) throw unsupported('custom metadata prototypes');
        const array = Array.isArray(value);
        const result: object = array
            ? []
            : Object.create(prototype as object | null) as object;
        seen.set(value, result);
        for (const key of Reflect.ownKeys(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor)) throw unsupported('metadata accessors');
            // These nodes remain private until the copy finishes. Populate ordinary
            // array elements before freezing; frozen indices force V8 dictionary storage.
            Object.defineProperty(result, key, {
                value: copy(descriptor.value),
                enumerable: descriptor.enumerable,
                writable: array,
                configurable: array && key !== 'length',
            });
        }
        Object.freeze(result);
        if (prototype === EntityMetadata.prototype) entities.push(result as EntityMetadata);
        return result;
    }
    const model = copy(source) as Model;
    // Validate the actual private copies, never a replaceable prototype getter.
    for (const entity of entities) {
        if (entity.materializer || entity.checkedMaterializer || entity.complexProperties.length > 0) {
            throw unsupported('custom materializers and complex properties');
        }
        for (const property of entity.properties) {
            if (property.converter) throw unsupported('value converters');
            if (property.defaultValue !== null &&
                (typeof property.defaultValue === 'object' || typeof property.defaultValue === 'function')) {
                throw unsupported('object or function defaults');
            }
        }
    }
    for (const entity of entities) onEntityCopied?.(entity);
    return model;
}

function unsupported(feature: string): ModelValidationError {
    return new ModelValidationError(
        `Compiled models do not yet support ${feature}. Use the dynamic DbContext.model() path.`,
        { contractViolation: 'unsupportedCompiledModel' },
    );
}
