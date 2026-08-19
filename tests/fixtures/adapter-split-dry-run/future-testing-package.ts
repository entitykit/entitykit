/**
 * Stands in for the future `@entitykit/testing` package.
 *
 * The provider-neutral test doubles are their own package in the decided
 * topology, not part of core: an application pulls them in as a dev dependency,
 * and core never imports them. This fixture exists so the dry run can prove that
 * a consumer composing core + testing + a provider still typechecks when the
 * three come from three different places.
 */
export { RecordingDatabaseConnection } from '../../../src/testing';
export type { RecordedDatabaseOperation } from '../../../src/testing';
