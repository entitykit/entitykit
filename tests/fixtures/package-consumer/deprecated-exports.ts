/* eslint @typescript-eslint/no-deprecated: off -- Exercise the deprecated consumer entry points. */
import {
    selectPropertyName as rootSelect,
    assertSynchronousCallbackResult as rootAssert,
    readSynchronousDate as rootDate,
} from '@entitykit/core';
import {
    selectPropertyName as focusedSelect,
    assertSynchronousCallbackResult as focusedAssert,
} from '@entitykit/core/adapter';
import { readSynchronousDate as focusedDate } from '@entitykit/core/tooling';

interface User { id: string; name: string }
const rootKey: keyof User = rootSelect<User>(user => user.id);
const focusedKey: keyof User = focusedSelect<User>(user => user.id);
rootAssert(undefined, 'callback', message => new Error(message));
focusedAssert(undefined, 'callback', message => new Error(message));
const rootTime: Date | undefined = rootDate(() => new Date(), 'clock');
const focusedTime: Date | undefined = focusedDate(() => new Date(), 'clock');
void [rootKey, focusedKey, rootTime, focusedTime];
