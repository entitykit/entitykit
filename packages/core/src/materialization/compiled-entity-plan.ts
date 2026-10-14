import { isCompiledEntityMetadata } from '../model/compiled-model';
import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';

interface CompiledEntityField {
    readonly property: PropertyMetadata;
    readonly name: string;
    readonly key: string;
    readonly context: string;
}

/** Contains mapping decisions only: no reader, entity, row or request state. */
export type CompiledEntityPlan = readonly CompiledEntityField[];

const plans: WeakMap<object, CompiledEntityPlan | undefined> = new WeakMap();
const entityFields = ['entityName', 'properties', 'complexProperties', 'materializer', 'checkedMaterializer'];
const propertyFields = ['propertyName', 'propertyPath', 'columnName', 'columnType', 'converter'];

export function compiledEntityPlan<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
): CompiledEntityPlan | undefined {
    if (!isCompiledEntityMetadata(metadata)) return undefined;
    if (plans.has(metadata)) return plans.get(metadata);
    const plan = createPlan(metadata);
    plans.set(metadata, plan);
    return plan;
}

function createPlan<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
): CompiledEntityPlan | undefined {
    if (entityFields.some(key => !Object.hasOwn(metadata, key))) return undefined;
    // Compilation validated these private copies as flat and callback-free.
    if (typeof metadata.entityName !== 'string') return undefined;
    const fields: CompiledEntityField[] = [];
    for (const property of metadata.properties) {
        if (propertyFields.some(key => !Object.hasOwn(property, key))) return undefined;
        if (!Array.isArray(property.propertyPath) || !Object.hasOwn(property.propertyPath, '0')) return undefined;
        const key: unknown = property.propertyPath[0];
        if (property.propertyPath.length !== 1 || typeof key !== 'string' || !key ||
            typeof property.propertyName !== 'string' || typeof property.columnName !== 'string' ||
            typeof property.columnType !== 'string' || property.converter) return undefined;
        fields.push(Object.freeze({
            property,
            name: property.propertyName,
            key,
            context: `${metadata.entityName}.${property.propertyName}`,
        }));
    }
    return Object.freeze(fields);
}
