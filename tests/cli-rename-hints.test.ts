import { parseRenameHintValues } from '../src/cli/cli-rename-hints';

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

    it.each([
        [['missing-target'], [], '--rename-table expects old_table=new_table.'],
        [[], ['events=payload'], '--rename-column supports'],
        [['audit..events=new_events'], [], 'cannot contain empty qualified parts'],
    ] as const)('rejects malformed rename hints', (tables, columns, message) => {
        expect(() => parseRenameHintValues(tables, columns))
            .toThrow(message);
    });
});
