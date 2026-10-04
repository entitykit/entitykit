import { defineJsonDiagnosticProviderTests } from './support/json-diagnostic-provider-contract';

describe('SQLite JSON diagnostic refusal and retry', () => {
    defineJsonDiagnosticProviderTests('sqlite', () => ':memory:');
});
