import type { EntityPropertyKey } from '../types';
import { FieldExpression } from './expression/field-expression';
import type { OrderExpression } from './expression/order-expression';
import { PredicateExpression } from './expression/predicate-expression';
import type { QueryField, QueryProxy } from './expression/query-field';
import { createQueryProxy } from './query-proxy';
import type { IncludeExpression, IncludeFilterModel } from './query-model';
import type {
    IncludeNavigationExpression as PublicIncludeNavigationExpression,
    IncludeProxy,
    NavigationElement,
} from './include-types';

export type { IncludeProxy, NavigationElement } from './include-types';

export class IncludeNavigationExpression<TEntity extends object, TNavigation = unknown>
implements PublicIncludeNavigationExpression<TEntity, TNavigation> {
    private predicate?: PredicateExpression;
    private readonly orderings: Array<OrderExpression<NavigationElement<TNavigation>>> = [];
    private offsetValue?: number;
    private limitValue?: number;

    constructor(public readonly navigationProperty: EntityPropertyKey<TEntity>) {}

    public get navigationPath(): readonly string[] {
        return [this.navigationProperty];
    }

    public where(selector: (entity: QueryProxy<NavigationElement<TNavigation>>) => PredicateExpression): this {
        const predicate = selector(createQueryProxy<NavigationElement<TNavigation>>());
        assertPredicateExpression(predicate, 'include where selectors');
        this.predicate = this.predicate ? this.predicate.and(predicate) : predicate;
        return this;
    }

    public orderBy<TProperty>(
        selector: (entity: QueryProxy<NavigationElement<TNavigation>>) => QueryField<TProperty> | OrderExpression<NavigationElement<TNavigation>>,
    ): this {
        this.orderings.push(normalizeOrdering(selector(createQueryProxy<NavigationElement<TNavigation>>()), 'asc'));
        return this;
    }

    public orderByDescending<TProperty>(
        selector: (entity: QueryProxy<NavigationElement<TNavigation>>) => QueryField<TProperty> | OrderExpression<NavigationElement<TNavigation>>,
    ): this {
        this.orderings.push(normalizeOrdering(selector(createQueryProxy<NavigationElement<TNavigation>>()), 'desc'));
        return this;
    }

    public skip(count: number): this {
        assertNonNegativeInteger(count, 'include skip');
        this.offsetValue = count;
        return this;
    }

    public take(count: number): this {
        assertNonNegativeInteger(count, 'include take');
        this.limitValue = count;
        return this;
    }

    public toIncludeExpression(path: readonly string[] = [this.navigationProperty]): IncludeExpression<TEntity> {
        return {
            navigationProperty: path[0] as EntityPropertyKey<TEntity>,
            navigationPath: [...path],
            filter: this.hasFilter() ? this.toFilter() as unknown as IncludeFilterModel : undefined,
        };
    }

    private hasFilter(): boolean {
        return this.predicate !== undefined || this.orderings.length > 0 || this.offsetValue !== undefined || this.limitValue !== undefined;
    }

    private toFilter(): IncludeFilterModel<NavigationElement<TNavigation>> {
        return {
            predicate: this.predicate,
            orderings: [...this.orderings],
            offset: this.offsetValue,
            limit: this.limitValue,
        };
    }
}

export function createIncludeProxy<TEntity extends object>(): IncludeProxy<TEntity> {
    return new Proxy(Object.create(null), {
        get(_target, propertyKey): IncludeNavigationExpression<TEntity> {
            if (typeof propertyKey !== 'string') {
                throw new Error('Include selectors must access a string property.');
            }

            return new IncludeNavigationExpression<TEntity, unknown>(propertyKey as EntityPropertyKey<TEntity>);
        },
    }) as IncludeProxy<TEntity>;
}

export function includePathKey(path: readonly string[]): string {
    return path.join('.');
}

function normalizeOrdering<TEntity extends object>(
    selected: QueryField<unknown> | OrderExpression<TEntity>,
    defaultDirection: 'asc' | 'desc',
): OrderExpression<TEntity> {
    if ('direction' in selected) {
        return selected;
    }

    if (selected instanceof FieldExpression) {
        return {
            propertyName: selected.propertyName as OrderExpression<TEntity>['propertyName'],
            direction: defaultDirection,
        };
    }

    throw new Error('include orderBy selectors must return a query field or order expression.');
}

function assertPredicateExpression(value: unknown, operation: string): asserts value is PredicateExpression {
    if (!(value instanceof PredicateExpression)) {
        throw new Error(`${operation} must return a predicate expression. Use field operators such as eq(), ne(), in(), isNull(), like(), or combine predicates with and()/or().`);
    }
}

function assertNonNegativeInteger(value: number, operation: string): void {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${operation} count must be a non-negative integer.`);
    }
}
