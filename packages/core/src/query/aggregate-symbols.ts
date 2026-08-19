/**
 * Branded symbols shared by the aggregate type declarations and the aggregate
 * runtime builders/guards.
 *
 * They live in their own leaf module because they are referenced from two
 * directions at once: the pure type declarations use them as `unique symbol`
 * computed keys, while the runtime factories stamp and read them at run time.
 * Keeping them here — importing nothing from the aggregate world — lets both
 * the type modules and the runtime modules depend on them without forming an
 * import cycle.
 */

export const aggregateFieldSymbol = Symbol('entitykit.aggregateField');
export const dateBucketGroupKeySymbol = Symbol('entitykit.dateBucketGroupKey');
export const groupKeyFieldSymbol = Symbol('entitykit.groupKeyField');
