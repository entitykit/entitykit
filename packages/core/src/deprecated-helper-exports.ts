import { selectPropertyName as selectPropertyNameImplementation } from './model/model-property-selector';
import { assertSynchronousCallbackResult as assertSynchronousCallbackResultImplementation } from './synchronous-callback';
import { readSynchronousDate as readSynchronousDateImplementation } from './synchronous-value';

/** @deprecated Import selectPropertyName from `@entitykit/core/adapter`. */
export const selectPropertyName: typeof selectPropertyNameImplementation = selectPropertyNameImplementation;

/** @deprecated Import assertSynchronousCallbackResult from `@entitykit/core/adapter`. */
export const assertSynchronousCallbackResult: typeof assertSynchronousCallbackResultImplementation = assertSynchronousCallbackResultImplementation;

/** @deprecated Import readSynchronousDate from `@entitykit/core/tooling`. */
export const readSynchronousDate: typeof readSynchronousDateImplementation = readSynchronousDateImplementation;
