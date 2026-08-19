import {
    encodeIdentityTuple,
    formatIdentityValue,
} from '../model/identity-value';

/**
 * Key handling shared by the save plan and the many-to-many change set.
 *
 * A key value has two forms: the model form the identity map and in-memory
 * matching use, and the provider form a statement binds. Mixing them is the
 * bug this pair exists to prevent, so both live together rather than being
 * reimplemented next to each caller.
 */
export function formatSaveIdentityValue(value: unknown): string {
    return formatIdentityValue(value);
}

export function encodeSaveIdentityTuple(values: readonly unknown[]): string {
    return encodeIdentityTuple(values);
}
