/** The side whose values should win an optimistic-concurrency conflict. */
export type ConcurrencyResolutionStrategy =
    | 'clientWins'
    | 'databaseWins';
