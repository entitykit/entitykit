import type { RestorationScope } from '../restoration-scope';
import { cloneNavigationContainer } from './navigation-collection-copy';
import { restoreNavigationValue } from './navigation-value-restoration';
import type { NavigationWriter } from './navigation-writer';
import { writeVerifiedNavigation } from './verified-navigation-write';

interface JournaledNavigationWrite {
    readonly entity: object;
    readonly navigationProperty: string;
    readonly entityName: string;
    readonly previous: unknown;
}

/**
 * Failure atomicity for a whole relationship operation.
 *
 * A verified write only *detects* an accessor that refuses its value; it does
 * not undo the graph writes that already succeeded in the same operation.
 * Include stitching and reference fix-up both publish several navigations
 * before one can fail, so the journal spans the operation rather than a single
 * write: it captures each navigation's previous value by identity (array
 * containers are copied, the entities inside them are not), and rolls the graph
 * back in reverse order, attempting every phase and verifying each restoration.
 * A restoration the accessor silently refuses is itself a failure, which
 * poisons the context through the owning {@link RestorationScope}.
 */
export class NavigationWriteJournal implements NavigationWriter {
    private readonly writes: JournaledNavigationWrite[] = [];

    /** Capture the current navigation value, then assign and verify the new one. */
    public write(
        entity: object,
        navigationProperty: string,
        value: unknown,
        entityName: string,
    ): unknown {
        this.writes.push({
            entity,
            navigationProperty,
            entityName,
            previous: cloneNavigationContainer(
                (entity as Record<string, unknown>)[navigationProperty],
            ),
        });
        return writeVerifiedNavigation(
            entity, navigationProperty, value, entityName,
        );
    }

    /** Reverse-order restoration of every navigation this journal wrote. */
    public restorationActions(): Array<() => void> {
        return [...this.writes].reverse().map(write => () => {
            restoreNavigationValue(
                write.entity,
                write.navigationProperty,
                write.previous,
                write.entityName,
            );
        });
    }

    /** Attempt every restoration inside the operation's scope. */
    public rollback(scope: RestorationScope): void {
        scope.attemptAll(this.restorationActions());
    }
}
