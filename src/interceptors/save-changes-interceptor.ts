import type { SavePlanEntry } from '../core/save-plan';

/** Diagnostic event emitted for saving changes. */ export interface SavingChangesEvent {
    /** The plan. */ readonly plan: readonly SavePlanEntry[];
}

/** Diagnostic event emitted for saved changes. */ export interface SavedChangesEvent {
    /** The plan. */ readonly plan: readonly SavePlanEntry[];
    /** The affected entities. */ readonly affectedEntities: number;
}

/** Diagnostic event emitted for save changes failed. */ export interface SaveChangesFailedEvent {
    /** The plan. */ readonly plan: readonly SavePlanEntry[];
    /** The error. */ readonly error: unknown;
}

/** Public contract for save changes interceptor. */ export interface SaveChangesInterceptor {
    /** Perform the saving changes operation. */ savingChanges?(event: SavingChangesEvent): void | Promise<void>;
    /** Perform the saved changes operation. */ savedChanges?(event: SavedChangesEvent): void | Promise<void>;
    /** Perform the save changes failed operation. */ saveChangesFailed?(event: SaveChangesFailedEvent): void | Promise<void>;
}
