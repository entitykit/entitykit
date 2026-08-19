/**
 * When a mapped value is produced by the database instead of application code.
 *
 * Generated properties are omitted from the corresponding write and hydrated
 * back onto the tracked entity after the statement succeeds.
 */
export enum ValueGenerated {
    /** Select the never behavior. */ Never = 'never',
    /** Select the on add behavior. */ OnAdd = 'onAdd',
    /** Select the on add or update behavior. */ OnAddOrUpdate = 'onAddOrUpdate',
}

export function isGeneratedOnAdd(value: ValueGenerated | undefined): boolean {
    return value === ValueGenerated.OnAdd ||
        value === ValueGenerated.OnAddOrUpdate;
}

export function isGeneratedOnUpdate(value: ValueGenerated | undefined): boolean {
    return value === ValueGenerated.OnAddOrUpdate;
}
