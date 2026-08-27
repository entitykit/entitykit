import { Inject, type InjectionToken } from '@nestjs/common';
import type { DbContext } from '@entitykit/core';
import type { EntityKitContextType } from './entity-kit-context-type.js';

const dataSourceToken = Symbol('EntityKitDataSource');
const contextRunnerTokens: WeakMap<object, symbol> = new WeakMap();

/** Return the Nest token for EntityKit's application-scoped data source. */
export function getEntityKitDataSourceToken(): InjectionToken {
    return dataSourceToken;
}

/** Return the stable Nest token for a context's safe runner. */
export function getEntityKitContextRunnerToken<TContext extends DbContext>(
    contextType: EntityKitContextType<TContext>,
): InjectionToken {
    const existing = contextRunnerTokens.get(contextType);
    if (existing !== undefined) {
        return existing;
    }
    const token = Symbol(`EntityKitContextRunner:${contextType.prototype.constructor.name}`);
    contextRunnerTokens.set(contextType, token);
    return token;
}

/** Inject EntityKit's application-scoped data source. */
export function InjectEntityKitDataSource(): ParameterDecorator {
    return Inject(getEntityKitDataSourceToken());
}

/** Inject the short-lived context runner registered for `contextType`. */
export function InjectEntityKitContextRunner<TContext extends DbContext>(
    contextType: EntityKitContextType<TContext>,
): ParameterDecorator {
    return Inject(getEntityKitContextRunnerToken(contextType));
}
