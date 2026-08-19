import type {
    EntitySnapshot,
    IndexSnapshot,
    PropertySnapshot,
} from '../model/model-snapshot-types';
import { formatDefaultValue } from '../schema/default-value';
import { defaultIndexName as sharedIndexName } from '../sql/identifiers';
import type { MigrationColumnDefinition } from './migration-builder';

/**
 * Leaf helpers shared by more than one facet detector.
 *
 * Column rendering, entity/property name resolution, and default object names
 * are needed by several detectors at once (a column definition by the table and
 * column detectors, `propertyColumn` by the index and foreign-key detectors).
 * They live here rather than in any one detector so no detector has to import
 * another just to borrow a primitive, keeping the detector graph acyclic.
 */

export function entityKey(entity: EntitySnapshot): string {
    return `${entity.schemaName ?? ''}.${entity.tableName}`;
}

export function toColumnDefinition(property: PropertySnapshot): MigrationColumnDefinition {
    return {
        name: property.columnName,
        type: renderColumnType(property),
        nullable: !property.isRequired,
        primaryKey: property.isPrimaryKey,
        defaultSql: property.defaultSql ?? defaultValueSql(property.defaultValue),
        computedSql: property.computedSql,
        computedStored: property.computedStored,
        collation: property.collation,
        storeGeneration: property.storeGeneration
            ? { ...property.storeGeneration }
            : undefined,
    };
}

export function renderColumnType(property: PropertySnapshot): string {
    if (property.maxLength && isTextType(property.columnType)) {
        return `varchar(${String(property.maxLength)})`;
    }

    return property.columnType;
}

function defaultValueSql(value: unknown): string | undefined {
    return value === undefined ? undefined : formatDefaultValue(value);
}

export function propertyColumn(entity: EntitySnapshot, propertyName: string): string {
    const property = entity.properties.find(item => item.propertyName === propertyName);
    if (!property) {
        throw new Error(`Index or foreign key on entity '${entity.entityName}' references missing property '${propertyName}'.`);
    }
    return property.columnName;
}

/**
 * The column for a property, falling back to the property name.
 *
 * A snapshot can reference a property that no longer exists — a rename hint
 * rewrites properties before the diff runs — and a name is still needed then.
 */
export function propertyColumnOrName(entity: EntitySnapshot, propertyName: string): string {
    return entity.properties.find(item => item.propertyName === propertyName)?.columnName ?? propertyName;
}

/**
 * Default names are built from column names, not property names.
 *
 * The object lives in the database, so its name should describe the database:
 * an index named for a TypeScript property matches nothing a reader can find
 * there. More importantly, a property rename that leaves the column alone is a
 * pure refactor, and deriving from property names turned it into a schema
 * migration that dropped and recreated the object for no reason.
 */
export function defaultIndexName(entity: EntitySnapshot, index: IndexSnapshot): string {
    return sharedIndexName(index.isUnique, entity.tableName, index.propertyNames.map(propertyName => propertyColumnOrName(entity, propertyName)));
}

function isTextType(columnType: string): boolean {
    return ['text', 'varchar', 'character varying'].includes(columnType.toLowerCase());
}
