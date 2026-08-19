import { AsyncLocalStorage } from 'node:async_hooks';
import { ContextConcurrentOperationError } from '../errors/runtime-errors';

interface OperationScope {
    readonly token: symbol;
    queryInProgress: boolean;
}

/** Serializes work that shares one context connection and transaction chain. */
export class ExclusiveOperationGuard {
    private readonly scope: AsyncLocalStorage<OperationScope> = new AsyncLocalStorage();
    private activeToken?: symbol;

    public get isOperationInProgress(): boolean {
        return this.activeToken !== undefined;
    }

    public async run<TResult>(
        operation: string,
        work: () => Promise<TResult>,
    ): Promise<TResult> {
        const current = this.scope.getStore();
        if (current && current.token === this.activeToken) {
            return work();
        }
        if (this.activeToken) {
            throw concurrentOperationError(operation);
        }

        const operationScope: OperationScope = {
            token: Symbol('entitykit-context-operation'),
            queryInProgress: false,
        };
        this.activeToken = operationScope.token;
        try {
            return await this.scope.run(operationScope, work);
        } finally {
            if (this.activeToken === operationScope.token) {
                this.activeToken = undefined;
            }
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
        const current = this.scope.getStore();
        let operationScope: OperationScope;
        let ownsToken = false;
        if (current && current.token === this.activeToken) {
            operationScope = current;
        } else {
            if (this.activeToken) {
                throw concurrentOperationError('a streaming query');
            }
            operationScope = {
                token: Symbol('entitykit-context-stream'),
                queryInProgress: false,
            };
            this.activeToken = operationScope.token;
            ownsToken = true;
        }

        if (operationScope.queryInProgress) {
            if (ownsToken) {
                this.activeToken = undefined;
            }
            throw concurrentOperationError('a streaming query');
        }

        operationScope.queryInProgress = true;
        try {
            for await (const row of createRows()) {
                yield row;
            }
        } finally {
            operationScope.queryInProgress = false;
            if (ownsToken && this.activeToken === operationScope.token) {
                this.activeToken = undefined;
            }
        }
    }

    private requireScope(): OperationScope {
        const operationScope = this.scope.getStore();
        if (!operationScope) {
            throw new Error('EntityKit operation scope was not initialized.');
        }
        return operationScope;
    }
}

function concurrentOperationError(operation: string): ContextConcurrentOperationError {
    return new ContextConcurrentOperationError(operation);
}
