import type { PropertyMetadata } from '../model/property-metadata';
import type { SqlDialect } from './sql-dialect';
import type { SqlParameterBag } from './sql-statement';

/** Bind one store value and render any provider-required comparison cast. */
export function propertyComparisonParameter(
    dialect: SqlDialect,
    parameters: SqlParameterBag,
    property: PropertyMetadata,
    storeValue: unknown,
): string {
    const parameter = parameters.add(storeValue);
    const columnType = property.columnType.trim().toLowerCase();
    return columnType === 'json' || columnType === 'jsonb'
        ? dialect.jsonComparisonParameter?.(parameter) ?? parameter
        : parameter;
}
