import { ContextConcurrentOperationError } from '../errors/runtime-errors';
import type { EntityEntry } from './entity-entry';

export class SaveMutationGuard {
    private executionDepth = 0;
    private pendingCount = 0;
    private pendingByEntity?: WeakMap<object, number>;
    private pendingByIdentity?: Map<string, number>;
    private upsertReservationCount = 0;
    private upsertReservations?: WeakMap<object, number>;

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
        const byEntity = this.pendingByEntity ??= new WeakMap<object, number>();
        const byIdentity = this.pendingByIdentity ??= new Map<string, number>();
        for (const entity of entities) {
            byEntity.set(
                entity,
                (byEntity.get(entity) ?? 0) + 1,
            );
            this.pendingCount += 1;
        }
        for (const identity of identities) {
            byIdentity.set(
                identity,
                (byIdentity.get(identity) ?? 0) + 1,
            );
        }
        let pending = true;
        return () => {
            if (!pending) return;
            pending = false;
            for (const entity of entities) {
                const count = byEntity.get(entity) ?? 0;
                if (count <= 1) byEntity.delete(entity);
                else byEntity.set(entity, count - 1);
                this.pendingCount -= 1;
            }
            for (const identity of identities) {
                const count = byIdentity.get(identity) ?? 0;
                if (count <= 1) byIdentity.delete(identity);
                else byIdentity.set(identity, count - 1);
            }
        };
    }

    public reserveUpsertInputs(entities: readonly object[]): () => void {
        this.assertUsable('upsert()');
        const reserved: Set<object> = new Set(entities);
        const reservations = this.upsertReservations ??= new WeakMap<object, number>();
        for (const entity of reserved) {
            if (reservations.has(entity)) {
                this.throwUpsertReservation('upsert()');
            }
        }
        for (const entity of reserved) {
            reservations.set(entity, 1);
            this.upsertReservationCount += 1;
        }
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            for (const entity of reserved) {
                reservations.delete(entity);
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
            entity && this.upsertReservations?.has(entity) ||
            entity === undefined && this.upsertReservationCount > 0
        ) {
            this.throwUpsertReservation(operation);
        }
        if (
            entity && this.pendingByEntity?.has(entity) ||
            identityKey !== undefined && this.pendingByIdentity?.has(identityKey) ||
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
