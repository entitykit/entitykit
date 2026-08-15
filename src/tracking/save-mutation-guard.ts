import { ContextConcurrentOperationError } from '../errors/runtime-errors';
import type { EntityEntry } from './entity-entry';

export class SaveMutationGuard {
    private executionDepth = 0;
    private pendingCount = 0;
    private readonly pendingByEntity: WeakMap<object, number> = new WeakMap();
    private readonly pendingByIdentity: Map<string, number> = new Map();
    private upsertReservationCount = 0;
    private readonly upsertReservations: WeakMap<object, number> = new WeakMap();

    constructor(
        private assertUsable: (operation: string) => void = () => undefined,
    ) {}

    public useUsabilityGuard(
        assertUsable: (operation: string) => void,
    ): void {
        this.assertUsable = assertUsable;
    }

    public beginExecution(): () => void {
        this.assertUsable('saveChanges()');
        this.executionDepth += 1;
        let active = true;
        return () => {
            if (active) {
                active = false;
                this.executionDepth -= 1;
            }
        };
    }

    public defer(
        entries: ReadonlyArray<EntityEntry<object>>,
        identityKeys: readonly string[],
    ): () => void {
        const entities = new Set(entries.map(entry => entry.entity));
        const identities = new Set(identityKeys);
        for (const entity of entities) {
            this.pendingByEntity.set(
                entity,
                (this.pendingByEntity.get(entity) ?? 0) + 1,
            );
            this.pendingCount += 1;
        }
        for (const identity of identities) {
            this.pendingByIdentity.set(
                identity,
                (this.pendingByIdentity.get(identity) ?? 0) + 1,
            );
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
            for (const identity of identities) {
                const count = this.pendingByIdentity.get(identity) ?? 0;
                if (count <= 1) this.pendingByIdentity.delete(identity);
                else this.pendingByIdentity.set(identity, count - 1);
            }
        };
    }

    public reserveUpsertInputs(entities: readonly object[]): () => void {
        this.assertUsable('upsert()');
        const reserved: Set<object> = new Set(entities);
        for (const entity of reserved) {
            if (this.upsertReservations.has(entity)) {
                this.throwUpsertReservation('upsert()');
            }
        }
        for (const entity of reserved) {
            this.upsertReservations.set(entity, 1);
            this.upsertReservationCount += 1;
        }
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            for (const entity of reserved) {
                this.upsertReservations.delete(entity);
                this.upsertReservationCount -= 1;
            }
        };
    }

    public assertMutation(
        operation: string,
        entity?: object,
        identityKey?: string,
    ): void {
        this.assertNoExecution(
            operation,
            'change tracked structure',
        );
        if (
            entity && this.upsertReservations.has(entity) ||
            entity === undefined && this.upsertReservationCount > 0
        ) {
            this.throwUpsertReservation(operation);
        }
        if (
            entity && this.pendingByEntity.has(entity) ||
            identityKey !== undefined && this.pendingByIdentity.has(identityKey) ||
            entity === undefined && this.pendingCount > 0
        ) {
            throw new ContextConcurrentOperationError(
                operation,
                `${operation} cannot change an entity accepted inside an open transaction. Complete or roll back the transaction first.`,
            );
        }
    }

    private throwUpsertReservation(operation: string): never {
        throw new ContextConcurrentOperationError(
            operation,
            `${operation} cannot proceed because an upsert input cannot become tracked or change tracking state until its transaction finishes.`,
        );
    }

    public assertNoExecution(
        operation: string,
        action = 'run',
    ): void {
        this.assertUsable(operation);
        if (this.executionDepth > 0) {
            throw new ContextConcurrentOperationError(
                operation,
                `${operation} cannot ${action} while saveChanges() SQL is executing. Await the save first.`,
            );
        }
    }
}
