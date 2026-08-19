import { restoreObjectProperty } from '../property-value-restoration';

export interface CreatedAncestorRestoration {
    readonly rollback: () => void;
    readonly restoreAfterWriteFailure: () => void;
}

/** Build one journal action plus its failure-atomic immediate counterpart. */
export function createdAncestorRestoration(
    target: Record<string, unknown>,
    property: string,
    previous: unknown,
    created: object,
    isPristine: () => boolean,
): CreatedAncestorRestoration {
    let pending = true;
    const take = (): boolean => {
        if (!pending) return false;
        pending = false;
        return true;
    };
    return {
        rollback: () => {
            if (!take()) return;
            if (target[property] === created && isPristine()) {
                restoreObjectProperty(target, property, previous);
            }
        },
        restoreAfterWriteFailure: () => {
            if (!take()) return;
            restoreObjectProperty(target, property, previous);
        },
    };
}
