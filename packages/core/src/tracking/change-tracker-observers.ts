/** Internal observer slots shared by tracker registry operations. */
export class ChangeTrackerObservers {
    private tracked?: (entity: object) => (() => void) | undefined;
    private detached?: (entity: object) => (() => void) | undefined;
    private acceptedAll?: () => void;
    private queuedWork?: (entity: object) => boolean;

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
    /** Register the probe for work queued outside the tracker on an entity. */
    public observeQueuedWork(probe: (entity: object) => boolean): void {
        this.queuedWork = probe;
    }
    /** Unprobed contexts hold no such work, so the answer defaults to `false`. */
    public hasQueuedWork(entity: object): boolean {
        return this.queuedWork?.(entity) === true;
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
