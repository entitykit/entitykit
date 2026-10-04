import { DbContextOptionsBuilder } from '../packages/core/src/core/context-options/db-context-options-builder';
import { createFakeProvider } from './support/fake-provider';

describe('provider validation before resource allocation', () => {
    it.each([null, undefined, false, 1, 'provider', {}, { name: '' }, { name: '  ' }, { name: 1 }])(
        'refuses an invalid provider identity %p', provider => {
            expect(() => new DbContextOptionsBuilder().useProvider(provider as never, 'fake://validation'))
                .toThrow('Database provider must supply a non-empty name.');
        },
    );

    it.each([
        ['dialect', undefined, 'runtime SQL dialect'],
        ['migrationDialect', undefined, 'migration SQL dialect'],
        ['createMigrationBuilder', undefined, 'migration builder factory'],
        ['createConnection', undefined, 'connection factory'],
        ['createDataSource', false, 'createDataSource must be a function'],
        ['isTransientError', null, 'isTransientError must be a function'],
        ['createSchemaIntrospector', {}, 'createSchemaIntrospector must be a function'],
        ['valueReader', {}, 'valueReader must supply readValue()'],
        ['valueReader', null, 'valueReader must supply readValue()'],
        ['valueReader', false, 'valueReader must supply readValue()'],
        ['valueReader', { readValue: 'invalid' }, 'valueReader must supply readValue()'],
    ])('identifies invalid provider service %s before opening a connection', (name, value, message) => {
        const provider = createFakeProvider();
        const createConnection = jest.spyOn(provider, 'createConnection');
        expect(() => new DbContextOptionsBuilder().useProvider(
            { ...provider, [name]: value }, 'fake://validation',
        )).toThrow('Database provider \'fake-provider\'');
        expect(() => new DbContextOptionsBuilder().useProvider(
            { ...provider, [name]: value }, 'fake://validation',
        )).toThrow(message);
        expect(createConnection).not.toHaveBeenCalled();
    });

    it('accepts optional capabilities while deferring connection allocation', () => {
        const provider = createFakeProvider();
        const createConnection = jest.spyOn(provider, 'createConnection');
        const createDataSource = jest.fn();
        const createSchemaIntrospector = jest.fn();
        expect(() => new DbContextOptionsBuilder().useProvider({
            ...provider, createDataSource, createSchemaIntrospector,
            isTransientError: (): boolean => false,
            valueReader: { readValue: (value: unknown): unknown => value },
        } as never, 'fake://validation')).not.toThrow();
        expect(() => new DbContextOptionsBuilder().useProvider({
            ...provider, createDataSource: undefined, createSchemaIntrospector: undefined,
            isTransientError: undefined, valueReader: undefined,
        } as never, 'fake://validation')).not.toThrow();
        expect(createConnection).not.toHaveBeenCalled();
        expect(createDataSource).not.toHaveBeenCalled();
        expect(createSchemaIntrospector).not.toHaveBeenCalled();
    });

    it.each([null, undefined, false, 1, {}, { providerName: '' }, { providerName: '  ' }])(
        'refuses an invalid data source identity %p', source => {
            expect(() => new DbContextOptionsBuilder().useDataSource(source as never))
                .toThrow('Database data source must supply a non-empty provider name.');
        },
    );

    it.each([
        ['dialect', undefined, 'runtime SQL dialect'],
        ['migrationDialect', undefined, 'migration SQL dialect'],
        ['createMigrationBuilder', false, 'migration builder factory'],
        ['createConnection', undefined, 'connection factory'],
        ['valueReader', {}, 'valueReader must supply readValue()'],
        ['valueReader', null, 'valueReader must supply readValue()'],
        ['valueReader', { readValue: false }, 'valueReader must supply readValue()'],
        ['valueReader', false, 'valueReader must supply readValue()'],
    ])('refuses malformed data source service %s before leasing a connection', (name, value, message) => {
        const provider = createFakeProvider();
        const createConnection = jest.spyOn(provider, 'createConnection');
        const source = { ...provider, providerName: provider.name, [name]: value };
        expect(() => new DbContextOptionsBuilder().useDataSource(source as never))
            .toThrow('Database data source \'fake-provider\'');
        expect(() => new DbContextOptionsBuilder().useDataSource(source as never))
            .toThrow(message);
        expect(createConnection).not.toHaveBeenCalled();
    });

    it.each([
        ['object', { readValue: (value: unknown): unknown => value }],
        ['callable', Object.assign((): number => 1, {
            readValue: (value: unknown): unknown => value,
        })],
    ] as const)('accepts a structurally valid %s reader without allocating resources', (_kind, valueReader) => {
        const provider = createFakeProvider();
        const createConnection = jest.fn(provider.createConnection.bind(provider, 'fake://validation'));
        const source = {
            providerName: provider.name,
            dialect: provider.dialect,
            migrationDialect: provider.migrationDialect,
            createMigrationBuilder: provider.createMigrationBuilder,
            createConnection, valueReader,
        };
        expect(() => new DbContextOptionsBuilder().useDataSource(source)).not.toThrow();
        expect(() => new DbContextOptionsBuilder().useProvider({ ...provider, valueReader }, 'fake://validation'))
            .not.toThrow();
        expect(createConnection).not.toHaveBeenCalled();
    });
});
