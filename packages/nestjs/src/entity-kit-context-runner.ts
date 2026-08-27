import type { DbContext, EntityKitDataSource } from '@entitykit/core';
import type { EntityKitContextType } from './entity-kit-context-type.js';

/** Runs one unit of work inside a fresh, automatically disposed context. */
export class EntityKitContextRunner<
    TContext extends DbContext,
    TArguments extends unknown[] = [],
> {
    constructor(
        private readonly dataSource: EntityKitDataSource,
        private readonly contextType: EntityKitContextType<TContext, TArguments>,
    ) {}

    /**
     * Create a context, await `work`, and dispose the context on every path.
     * Constructor arguments after `work` are forwarded to the context.
     */
    public async run<TResult>(
        work: (context: TContext) => TResult | Promise<TResult>,
        ...arguments_: TArguments
    ): Promise<TResult> {
        const context = this.contextType.create(this.dataSource, ...arguments_);
        let result: TResult;
        try {
            result = await work(context);
        } catch (workError) {
            try {
                await context.dispose();
            } catch (disposalError) {
                throw new AggregateError(
                    [workError, disposalError],
                    'EntityKit context work and disposal both failed.',
                    {
                        // eslint-disable-next-line preserve-caught-error -- Work is primary; the aggregate also retains disposalError.
                        cause: workError,
                    },
                );
            }
            throw workError;
        }
        await context.dispose();
        return result;
    }
}
