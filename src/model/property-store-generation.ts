import type {
    IdentityColumnOptions,
    RowIdColumnOptions,
    StoreGenerationStrategy,
} from './store-generation';
import { identityGeneration } from './store-generation';
import { requireNonEmpty } from './require-non-empty';

interface StoreGeneratedProperty {
    storeGeneration?: StoreGenerationStrategy;
    isRequired?: boolean;
}

export function configureIdentity(
    property: StoreGeneratedProperty,
    options: IdentityColumnOptions,
): void {
    configure(property, identityGeneration(options));
}

export function configureAutoIncrement(
    property: StoreGeneratedProperty,
): void {
    configure(property, { kind: 'autoIncrement' });
}

export function configureRowId(
    property: StoreGeneratedProperty,
    options: RowIdColumnOptions,
): void {
    configure(property, {
        kind: 'rowid',
        preventReuse: options.preventReuse ?? false,
    });
}

export function configureSequence(
    property: StoreGeneratedProperty,
    name: string,
    schemaName: string | undefined,
): void {
    configure(property, {
        kind: 'sequence',
        name: requireNonEmpty(name, 'sequence name'),
        schemaName: schemaName === undefined
            ? undefined
            : requireNonEmpty(schemaName, 'sequence schema'),
    });
}

function configure(
    property: StoreGeneratedProperty,
    strategy: StoreGenerationStrategy,
): void {
    property.storeGeneration = strategy;
    property.isRequired = true;
}
