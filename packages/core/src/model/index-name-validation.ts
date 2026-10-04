import { defaultIndexName } from '../relational-identifiers';
import { ModelValidationError } from '../errors/model-validation-error';

interface IndexNameEntity {
    readonly entityName: string;
    readonly tableName: string;
    readonly properties: ReadonlyArray<{ readonly propertyName: string; readonly columnName: string }>;
    readonly indexes: ReadonlyArray<{
        readonly propertyNames: readonly string[];
        readonly isUnique: boolean;
        readonly databaseName?: string;
        readonly keyParts?: ReadonlyArray<
            { readonly kind: 'property'; readonly propertyName: string }
            | { readonly kind: 'expression'; readonly expression: string }>;
        readonly includedPropertyNames?: readonly string[];
        readonly filter?: string;
    }>;
}

/** Refuse conflicting definitions of one physical index before schema SQL or diffing. */
export function validateIndexDatabaseNames(entity: IndexNameEntity, providerName?: string): void {
    const columns = new Map(entity.properties.map(property => [property.propertyName, property.columnName]));
    const columnName = (propertyName: string): string => columns.get(propertyName) ?? propertyName;
    const definitions: Map<string, { readonly name: string; readonly definition: string }> = new Map();
    for (const index of entity.indexes) {
        const name = index.databaseName ?? defaultIndexName(index.isUnique, entity.tableName,
            index.propertyNames.map(columnName));
        const identity = providerName === 'sqlite' || providerName === 'mysql'
            ? name.replace(/[A-Z]/g, character => character.toLowerCase()) : name;
        const definition = JSON.stringify([
            index.isUnique,
            (index.keyParts ?? index.propertyNames.map(propertyName => ({ kind: 'property' as const, propertyName })))
                .map(part => part.kind === 'property' ? ['column', columnName(part.propertyName)] : ['expression', part.expression]),
            index.includedPropertyNames?.map(columnName) ?? [],
            index.filter ?? null,
        ]);
        const existing = definitions.get(identity);
        if (existing && (existing.name !== name || existing.definition !== definition)) {
            throw new ModelValidationError(`Entity '${entity.entityName}' maps multiple indexes to database name '${name}'. Configure distinct index database names.`);
        }
        definitions.set(identity, { name, definition });
    }
}
