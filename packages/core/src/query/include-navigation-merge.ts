import { copyNavigationCollection } from '../tracking/navigation-collection-copy';
import {
    directNavigationWriter,
    type NavigationWriter,
} from '../tracking/navigation-writer';

/**
 * Publish a copy of the navigation that also holds the newly loaded items.
 *
 * The live collection is never appended to in place: batched includes merge
 * into a copy and assign it, so a frozen or readonly collection loads, and a
 * failed merge leaves the collection the entity already had.
 */
export function mergeNavigationItems(
    values: Record<string, unknown>,
    navigationProperty: string,
    items: readonly object[],
    entityName: string,
    writer: NavigationWriter = directNavigationWriter,
): void {
    const collection = copyNavigationCollection(values[navigationProperty]);
    const seen = new Set(collection);

    for (const item of items) {
        if (!seen.has(item)) {
            collection.push(item);
            seen.add(item);
        }
    }

    writer.write(values, navigationProperty, collection, entityName);
}
