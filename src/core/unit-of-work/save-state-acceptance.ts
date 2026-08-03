export interface SaveStateAcceptance {
    commit(): void;
    rollback(): void;
}
