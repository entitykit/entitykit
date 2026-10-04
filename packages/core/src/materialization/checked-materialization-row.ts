import type {
    EntityMaterializationRow,
    MaterializationGuard,
    MaterializationScalar,
} from '../model/checked-materialization-types';
import type { EntityMetadata } from '../model/entity-metadata';
import { selectPropertyPath, type PropertyPathSelector } from '../model/model-property-selector';
import { assertSynchronousCallbackResult } from '../synchronous-callback';
import { isCheckedScalarValue } from './checked-scalar-value';

/** Read the captured model values without running a provider or converter again. */
export class CheckedMaterializationRow<TEntity extends object> implements EntityMaterializationRow<TEntity> {
    constructor(
        private readonly metadata: EntityMetadata<TEntity>,
        private readonly values: Readonly<Record<string, unknown>>,
    ) {}

    public required<TValue>(selector: PropertyPathSelector<TEntity, TValue>): MaterializationScalar<NonNullable<TValue>>;
    public required<TValue>(selector: PropertyPathSelector<TEntity, TValue>, guard: MaterializationGuard<NoInfer<NonNullable<TValue>>>): NonNullable<TValue>;
    public required(selector: PropertyPathSelector<TEntity>, guard?: MaterializationGuard<unknown>): unknown {
        return this.read(selector, false, guard);
    }

    public nullable<TValue>(selector: PropertyPathSelector<TEntity, TValue>): MaterializationScalar<NonNullable<TValue>> | null;
    public nullable<TValue>(selector: PropertyPathSelector<TEntity, TValue>, guard: MaterializationGuard<NoInfer<NonNullable<TValue>>>): NonNullable<TValue> | null;
    public nullable(selector: PropertyPathSelector<TEntity>, guard?: MaterializationGuard<unknown>): unknown {
        return this.read(selector, true, guard);
    }

    private read(selector: PropertyPathSelector<TEntity>, nullable: boolean, guard?: MaterializationGuard<unknown>): unknown {
        const name = selectPropertyPath(selector).join('.');
        const context = `${this.metadata.entityName}.${name}`;
        const fail = (reason: string): TypeError => new TypeError(`Cannot materialize '${context}': ${reason}.`);
        const property = this.metadata.tryGetProperty(name);
        if (!property) throw fail('select a mapped scalar property');
        const value = this.values[name];
        if (value === undefined) throw fail('the mapped value is missing');
        if (value === null) {
            if (!nullable || property.isRequired) throw fail('NULL is not allowed');
            return null;
        }
        if (guard) {
            let accepted: unknown;
            try {
                accepted = guard(value);
            } catch (cause) {
                throw new TypeError(`Cannot materialize '${context}': the value guard threw.`, { cause });
            }
            assertSynchronousCallbackResult(accepted, `Materialization guard for '${context}'`, message => new TypeError(message));
            if (accepted !== true) throw fail('the value did not pass its guard');
            return value;
        }
        if (property.converter) throw fail('the conversion requires an explicit value guard');
        const valid = isCheckedScalarValue(value, property.columnType);
        if (valid === undefined) throw fail(`SQL type '${property.columnType}' requires an explicit value guard`);
        if (!valid) throw fail(`the value does not match SQL type '${property.columnType}'`);
        return value;
    }
}
