import { isCompiledEntityMetadata } from '../model/compiled-model';
import { EntityMetadata, originalEntityIdentityMethods } from '../model/entity-metadata';
import { EntityKeyMetadata, originalEntityKeyIdentityMethod } from '../model/entity-key-metadata';

/** Mapping names only. No query, bound record or identity is shared by a plan. */
export type QueryIdentityPlan = readonly string[];
export interface QueryIdentityProof {
    readonly metadata: object;
    readonly boundValues: Readonly<Record<string, unknown>>;
    readonly names: QueryIdentityPlan;
    readonly values: readonly unknown[];
}
const plans: WeakMap<object, QueryIdentityPlan | undefined> = new WeakMap();

function methodMatches(prototype: object, name: string, expected: unknown): boolean {
    return Object.getOwnPropertyDescriptor(prototype, name)?.value === expected;
}
function unchangedMethods(): boolean {
    return methodMatches(EntityMetadata.prototype, 'createIdentityKeyFromProviderValues', originalEntityIdentityMethods.encode) &&
        methodMatches(EntityMetadata.prototype, 'key', originalEntityIdentityMethods.key) &&
        methodMatches(EntityKeyMetadata.prototype, 'createIdentityKeyFromProviderValues', originalEntityKeyIdentityMethod);
}

/** Resolve once per batch, and only for privately owned compiled metadata. */
export function queryIdentityPlan<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
): QueryIdentityPlan | undefined {
    if (!isCompiledEntityMetadata(metadata)) return undefined;
    if (plans.has(metadata)) return plans.get(metadata);
    let plan: QueryIdentityPlan | undefined;
    const keyMetadata: unknown = Object.getOwnPropertyDescriptor(metadata, 'keyMetadata')?.value;
    if (Object.getPrototypeOf(metadata) === EntityMetadata.prototype && keyMetadata &&
        Object.getPrototypeOf(keyMetadata) === EntityKeyMetadata.prototype &&
        !Object.hasOwn(metadata, 'createIdentityKeyFromProviderValues') && !Object.hasOwn(metadata, 'key') &&
        !Object.hasOwn(keyMetadata, 'createIdentityKeyFromProviderValues')) {
        const names = [...metadata.keyProperties];
        if (metadata.tenantKeyProperty && !names.includes(metadata.tenantKeyProperty)) names.push(metadata.tenantKeyProperty);
        if (names.length && names.every(name => typeof name === 'string')) plan = Object.freeze(names);
    }
    plans.set(metadata, plan);
    return plan;
}

export function captureQueryIdentityProof(
    metadata: object,
    boundValues: Readonly<Record<string, unknown>>,
    names: QueryIdentityPlan,
): QueryIdentityProof | undefined {
    if (!unchangedMethods()) return undefined;
    const values: unknown[] = [];
    for (const name of names) {
        const descriptor = Object.getOwnPropertyDescriptor(boundValues, name);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined;
        const value: unknown = descriptor.value;
        if (value !== null && (typeof value === 'object' || typeof value === 'function')) return undefined;
        values.push(value);
    }
    return { metadata, boundValues, names, values };
}

/** Constructors and property writes may have changed methods or exposed values. */
export function queryIdentityProofMatches(
    proof: QueryIdentityProof,
    metadata: object,
    boundValues: Readonly<Record<string, unknown>>,
): boolean {
    if (proof.metadata !== metadata || proof.boundValues !== boundValues || !unchangedMethods()) return false;
    for (let i = 0; i < proof.names.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(boundValues, proof.names[i]);
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !Object.is(descriptor.value, proof.values[i])) return false;
    }
    return true;
}
