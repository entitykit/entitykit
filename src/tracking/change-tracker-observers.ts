/** Internal observer slots shared by tracker registry operations. */
export class ChangeTrackerObservers {
    private tracked?: (entity: object) => (() => void) | undefined;
    private detached?: (entity: object) => (() => void) | undefined;
    private acceptedAll?: () => void;

    public observeTracked(
        observer: (entity: object) => (() => void) | undefined,
    ): void {
        this.tracked = observer;
    }
    public observeDetached(
        observer: (entity: object) => (() => void) | undefined,
    ): void {
        this.detached = observer;
    }
    public observeAcceptedAll(observer: () => void): void {
        this.acceptedAll = observer;
    }
    public notifyTracked(entity: object): (() => void) | undefined {
        return this.tracked?.(entity);
    }
    public notifyDetached(entity: object): (() => void) | undefined {
        return this.detached?.(entity);
    }
    public notifyAcceptedAll(): void {
        this.acceptedAll?.();
    }
}
