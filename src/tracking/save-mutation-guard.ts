import { ContextConcurrentOperationError } from '../errors/runtime-errors';
import type { EntityEntry } from './entity-entry';

export class SaveMutationGuard {
    private executionDepth = 0;
    private pendingCount = 0;
    private readonly pendingByEntity: WeakMap<object, number> = new WeakMap();

    public beginExecution(): () => void {
        this.executionDepth += 1;
        let active = true;
        return () => {
            if (active) {
                active = false;
                this.executionDepth -= 1;
            }
        };
    }

    public defer(entries: ReadonlyArray<EntityEntry<object>>): () => void {
        const entities = new Set(entries.map(entry => entry.entity));
        for (const entity of entities) {
            this.pendingByEntity.set(
                entity,
                (this.pendingByEntity.get(entity) ?? 0) + 1,
            );
            this.pendingCount += 1;
        }
        let pending = true;
        return () => {
            if (!pending) return;
            pending = false;
            for (const entity of entities) {
                const count = this.pendingByEntity.get(entity) ?? 0;
                if (count <= 1) this.pendingByEntity.delete(entity);
                else this.pendingByEntity.set(entity, count - 1);
                this.pendingCount -= 1;
            }
        };
    }

    public assertMutation(operation: string, entity?: object): void {
        if (this.executionDepth > 0) {
            throw new ContextConcurrentOperationError(
                operation,
                `${operation} cannot change tracked structure while saveChanges() SQL is executing. Await the save first.`,
            );
        }
        if (
            entity && this.pendingByEntity.has(entity) ||
            entity === undefined && this.pendingCount > 0
        ) {
            throw new ContextConcurrentOperationError(
                operation,
                `${operation} cannot change an entity accepted inside an open transaction. Complete or roll back the transaction first.`,
            );
        }
    }
}
