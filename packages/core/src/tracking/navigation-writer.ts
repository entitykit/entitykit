import { writeVerifiedNavigation } from './verified-navigation-write';

/** Publishes one navigation value; a journal adds failure-atomic rollback. */
export interface NavigationWriter {
    write(
        entity: object,
        navigationProperty: string,
        value: unknown,
        entityName: string,
    ): unknown;
}

/** Writer for call paths whose restoration is owned by an outer journal. */
export const directNavigationWriter: NavigationWriter = {
    write: (entity, navigationProperty, value, entityName) =>
        writeVerifiedNavigation(entity, navigationProperty, value, entityName),
};
