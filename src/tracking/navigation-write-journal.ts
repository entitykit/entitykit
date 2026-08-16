import type { RestorationScope } from '../restoration-scope';
import { cloneNavigationContainer } from './navigation-collection-copy';
import { navigationValueChanged } from './navigation-snapshot';
import { restoreNavigationValue } from './navigation-value-restoration';
import type { NavigationWriter } from './navigation-writer';
import { writeVerifiedNavigation } from './verified-navigation-write';

interface JournaledNavigationWrite {
    readonly entity: object;
    readonly navigationProperty: string;
    readonly entityName: string;
    readonly previous: unknown;
    applied?: unknown;
    verified: boolean;
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
 *
 * The journal restores only the values it still owns. A load runs concurrently
 * with the rest of the context, so a `link()`, an `unlink()`, or an accepted
 * reference move can publish a *newer* value over one of these writes while the
 * load is still in flight. Rewinding that would hand back a graph the database
 * already disagrees with, so a superseded write fails closed instead: the newer
 * value stays, the load's own error stays primary, and the ambiguity poisons
 * the context rather than being silently resolved in the rollback's favour.
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
        const write: JournaledNavigationWrite = {
            entity,
            navigationProperty,
            entityName,
            previous: cloneNavigationContainer(
                (entity as Record<string, unknown>)[navigationProperty],
            ),
            verified: false,
        };
        this.writes.push(write);
        const applied = writeVerifiedNavigation(
            entity, navigationProperty, value, entityName,
        );
        // Copied, so a later in-place mutation of the live container is a
        // supersession this journal can still see at rollback time.
        write.applied = cloneNavigationContainer(applied);
        write.verified = true;
        return applied;
    }

    /** Reverse-order restoration of every navigation this journal wrote. */
    public restorationActions(): Array<() => void> {
        return [...this.writes].reverse().map(write => () => {
            refuseSupersededRestoration(write);
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

/**
 * Refuse to roll back a write whose navigation has moved on since it landed.
 *
 * Only a *verified* write has a value the journal can claim: a forward write
 * that threw before verification may have mutated the accessor part-way, and
 * restoring it unconditionally stays the only safe move there. For the rest,
 * the live value is read back and compared against what the write actually
 * published. Reverse-order unwinding compares each write against the live value
 * at *its own* restore time, which is what the inner restoration just wrote, so
 * several writes to one navigation compose instead of tripping this guard.
 *
 * The read is deliberately part of the guard: a navigation whose getter has
 * turned hostile cannot be shown to still belong to this load, so the read
 * failure propagates into the operation's cleanup failures instead of falling
 * through to an overwrite.
 */
function refuseSupersededRestoration(write: JournaledNavigationWrite): void {
    if (!write.verified) return;
    const current = (write.entity as Record<string, unknown>)[
        write.navigationProperty
    ];
    if (!navigationValueChanged(write.applied, current)) return;
    throw new Error(
        `Navigation '${write.entityName}.${write.navigationProperty}' ` +
        'changed while its load was in progress; rollback cannot ' +
        'safely overwrite the newer value.',
    );
}
