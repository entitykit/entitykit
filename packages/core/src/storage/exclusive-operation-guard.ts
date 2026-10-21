import { AsyncLocalStorage } from 'node:async_hooks';
import { ContextConcurrentOperationError } from '../errors/runtime-errors';

interface QueryScope {
    queryInProgress: boolean;
}

interface OperationScope extends QueryScope {
    readonly token: symbol;
    readonly parent?: OperationScope;
    active: boolean;
}

// One store bounds both Node 22's async-hook registrations and Node 24's
// copied context-frame keys. Tokens still belong to individual guard operations.
const operationScopes: AsyncLocalStorage<OperationScope> = new AsyncLocalStorage();

/** Serializes work that shares one context connection and transaction chain. */
export class ExclusiveOperationGuard {
    private activeToken?: symbol;

    public get isOperationInProgress(): boolean {
        return this.activeToken !== undefined;
    }

    public async run<TResult>(
        operation: string,
        work: () => Promise<TResult>,
    ): Promise<TResult> {
        const current = this.currentScope();
        if (current) {
            return work();
        }
        if (this.activeToken) {
            throw concurrentOperationError(operation);
        }

        const operationScope: OperationScope = {
            token: Symbol('entitykit-context-operation'),
            parent: activeParentScope(),
            active: true,
            queryInProgress: false,
        };
        this.activeToken = operationScope.token;
        try {
            return await operationScopes.run(operationScope, work);
        } finally {
            operationScope.active = false;
            this.activeToken = undefined;
        }
    }

    public async runQuery<TResult>(
        operation: string,
        work: () => Promise<TResult>,
    ): Promise<TResult> {
        return this.run(operation, async () => {
            const operationScope = this.requireScope();
            if (operationScope.queryInProgress) {
                throw concurrentOperationError(operation);
            }
            operationScope.queryInProgress = true;
            try {
                return await work();
            } finally {
                operationScope.queryInProgress = false;
            }
        });
    }

    public async *stream<TRow>(
        createRows: () => AsyncIterable<TRow>,
    ): AsyncGenerator<TRow> {
        const current = this.currentScope();
        let operationScope: QueryScope;
        let ownsToken = false;
        if (current) {
            operationScope = current;
        } else {
            if (this.activeToken) {
                throw concurrentOperationError('a streaming query');
            }
            operationScope = {
                queryInProgress: false,
            };
            this.activeToken = Symbol('entitykit-context-stream');
            ownsToken = true;
        }

        if (operationScope.queryInProgress) {
            throw concurrentOperationError('a streaming query');
        }

        operationScope.queryInProgress = true;
        try {
            for await (const row of createRows()) {
                yield row;
            }
        } finally {
            operationScope.queryInProgress = false;
            if (ownsToken) {
                this.activeToken = undefined;
            }
        }
    }

    private requireScope(): OperationScope {
        const operationScope = this.currentScope();
        if (!operationScope) {
            throw new Error('EntityKit operation scope was not initialized.');
        }
        return operationScope;
    }

    private currentScope(): OperationScope | undefined {
        if (!this.activeToken) return undefined;
        let current = operationScopes.getStore();
        while (current) {
            if (current.token === this.activeToken) return current;
            current = current.parent;
        }
        return undefined;
    }
}

function activeParentScope(): OperationScope | undefined {
    let parent = operationScopes.getStore();
    // A detached continuation can outlive its owner. Do not extend a chain of
    // expired scopes each time that continuation starts another operation.
    while (parent && !parent.active) parent = parent.parent;
    return parent;
}

function concurrentOperationError(operation: string): ContextConcurrentOperationError {
    return new ContextConcurrentOperationError(operation);
}
