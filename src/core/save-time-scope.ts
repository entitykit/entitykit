/** Values supplied by the active context while a save is prepared. */
export interface SaveTimeScope {
    now(): Date;
    currentUserId(): unknown;
    currentTenantId(): unknown;
    allowsCrossTenantAccess(): boolean;
}
