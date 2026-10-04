import { parseRenameHintValues } from '../packages/cli/src/cli-rename-hints';
import { CliUsageError } from '../packages/cli/src/cli-usage-error';

describe('CLI rename hints', () => {
    it('returns no hints when no rename options are present', () => {
        expect(parseRenameHintValues([], [])).toBeUndefined();
    });

    it('parses qualified table and column renames', () => {
        expect(parseRenameHintValues(
            ['audit.old_events=new_events'],
            ['audit.old_events.payload=body'],
        )).toEqual({
            tables: [{ schemaName: 'audit', from: 'old_events', to: 'new_events' }],
            columns: [{
                schemaName: 'audit',
                tableName: 'old_events',
                from: 'payload',
                to: 'body',
            }],
        });
    });

    it('keeps a table-only rename with an unqualified source', () => {
        expect(parseRenameHintValues(['old_events=new_events'], []))
            .toEqual({
                tables: [{ from: 'old_events', to: 'new_events' }],
                columns: [],
            });
    });

    it('keeps a column-only rename with an unqualified table', () => {
        expect(parseRenameHintValues([], ['events.payload=body']))
            .toEqual({
                tables: [],
                columns: [{ tableName: 'events', from: 'payload', to: 'body' }],
            });
    });

    it('preserves option order and uses the name of a qualified destination', () => {
        expect(parseRenameHintValues(
            ['audit.old_events=audit.new_events', 'old_users=new_users'],
            ['audit.old_events.payload=audit.new_events.body', 'users.name=display_name'],
        )).toEqual({
            tables: [
                { schemaName: 'audit', from: 'old_events', to: 'new_events' },
                { from: 'old_users', to: 'new_users' },
            ],
            columns: [
                { schemaName: 'audit', tableName: 'old_events', from: 'payload', to: 'body' },
                { tableName: 'users', from: 'name', to: 'display_name' },
            ],
        });
    });

    it.each(['', 'events', 'events=', '=events', 'old=new=extra', 'old=new='])(
        'reports the table option syntax for %j', value => {
            expect(() => parseRenameHintValues([value], []))
                .toThrow(new CliUsageError('--rename-table expects old_table=new_table.'));
        });

    it('refuses a table source with more than one schema qualifier', () => {
        expect(() => parseRenameHintValues(['catalog.audit.events=new_events'], []))
            .toThrow(new CliUsageError(
                '--rename-table supports old_table=new_table or schema.old_table=new_table.',
            ));
    });

    it.each(['', 'events.payload', 'events.payload=', '=body', 'events.payload=body=extra'])(
        'reports the column option syntax for %j', value => {
            expect(() => parseRenameHintValues([], [value]))
                .toThrow(new CliUsageError('--rename-column expects table.old_column=new_column.'));
        });

    it.each(['payload=body', 'catalog.audit.events.payload=body'])(
        'refuses a column source without a table or with too many qualifiers: %j', value => {
            expect(() => parseRenameHintValues([], [value]))
                .toThrow(new CliUsageError(
                    '--rename-column supports table.old_column=new_column or schema.table.old_column=new_column.',
                ));
        });

    it.each(['.events=new_events', 'audit..events=new_events', 'events=.new_events', 'events=new_events.'])(
        'identifies the table option when a qualified part is empty: %j', value => {
            expect(() => parseRenameHintValues([value], []))
                .toThrow(new CliUsageError('--rename-table identifiers cannot contain empty qualified parts.'));
        });

    it.each(['.payload=body', 'events..payload=body', 'events.payload=.body', 'events.payload=body.'])(
        'identifies the column option when a qualified part is empty: %j', value => {
            expect(() => parseRenameHintValues([], [value]))
                .toThrow(new CliUsageError('--rename-column identifiers cannot contain empty qualified parts.'));
        });

    it.each([
        [['missing-target'], [], '--rename-table expects old_table=new_table.'],
        [[], ['events=payload'], '--rename-column supports'],
        [['audit..events=new_events'], [], 'cannot contain empty qualified parts'],
    ] as const)('rejects malformed rename hints', (tables, columns, message) => {
        expect(() => parseRenameHintValues(tables, columns))
            .toThrow(message);
    });
});
