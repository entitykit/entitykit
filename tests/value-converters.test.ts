import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import {
    enumString,
    valueConverter,
    type ValueConverter,
} from '../src';
import type { EntityMetadata } from '../src/model/entity-metadata';
import { createQueryModel, createQueryProxy, Materializer } from '../src/experimental';
import { ModificationSqlBuilder } from '../src/sql/modification-sql-builder';
import { SelectSqlBuilder } from '../src/sql/select-sql-builder';
import { toStoreValue } from '../src/model/value-converter';
import { ChangeTracker } from '../src/tracking/change-tracker';

type LoginProvider = 'Google' | 'GitHub';

class UserLogin {
    public id!: string;
    public provider!: LoginProvider;
    public providerKey!: string;

    constructor(data?: Partial<UserLogin>) {
        Object.assign(this, data);
    }
}

const providerConverter: ValueConverter<LoginProvider, string> = valueConverter({
    toProvider(value) {
        return value.toLowerCase();
    },
    fromProvider(value) {
        return value === 'google' ? 'Google' : 'GitHub';
    },
});

function createMetadata(): EntityMetadata<UserLogin> {
    const model = new ModelBuilderImplementation();
    model.entity(UserLogin, entity => {
        entity.toTable('user_logins');
        entity.hasKey(login => login.id);
        entity.property(login => login.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(login => login.provider).hasColumnName('provider').hasColumnType('text').hasConversion(providerConverter).isRequired();
        entity.property(login => login.providerKey).hasColumnName('provider_key').hasColumnType('text').isRequired();
    });
    return model.build().getEntity(UserLogin);
}

describe('value converters', () => {
    it('applies converters to query parameters', () => {
        const metadata = createMetadata();
        const login = createQueryProxy<UserLogin>();
        const query = {
            ...createQueryModel(UserLogin),
            predicate: login.provider.eq('Google'),
        };

        expect(new SelectSqlBuilder().build(metadata, query)).toEqual({
            text: 'select "id", "provider", "provider_key" from "user_logins" where "provider" = $1',
            values: ['google'],
        });
    });

    it('applies converters to insert, update, and upsert values', () => {
        const metadata = createMetadata();
        const entity = new UserLogin({ id: 'login_1', provider: 'GitHub', providerKey: '123' });
        const builder = new ModificationSqlBuilder();

        expect(builder.buildInsert(metadata, entity)).toEqual({
            text: 'insert into "user_logins" ("id", "provider", "provider_key") values ($1, $2, $3)',
            values: ['login_1', 'github', '123'],
        });

        entity.provider = 'Google';
        expect(builder.buildUpdate(metadata, entity, ['provider'])).toEqual({
            text: 'update "user_logins" set "provider" = $1 where "id" = $2',
            values: ['google', 'login_1'],
        });

        expect(builder.buildPostgresUpsert(metadata, entity, {
            conflictProperties: ['provider'],
            updateProperties: ['providerKey'],
        })).toEqual({
            text: 'insert into "user_logins" ("id", "provider", "provider_key") values ($1, $2, $3) on conflict ("provider") do update set "provider_key" = excluded."provider_key"',
            values: ['login_1', 'google', '123'],
        });
    });

    it('applies converters to set-based Postgres write statements', () => {
        const metadata = createMetadata();
        const login = createQueryProxy<UserLogin>();
        const builder = new ModificationSqlBuilder();

        expect(builder.buildPostgresUpdate(metadata, {
            values: { provider: 'Google' },
            predicate: login.provider.eq('GitHub').node,
        })).toEqual({
            text: 'update "user_logins" set "provider" = $1 where "provider" = $2',
            values: ['google', 'github'],
        });

        expect(builder.buildPostgresDelete(metadata, {
            predicate: login.provider.eq('Google').node,
        })).toEqual({
            text: 'delete from "user_logins" where "provider" = $1',
            values: ['google'],
        });
    });

    it('applies converters during materialization', () => {
        const metadata = createMetadata();
        const login = new Materializer().materialize(metadata, {
            id: 'login_1',
            provider: 'google',
            provider_key: 'abc',
        }, new ChangeTracker());

        expect(login).toBeInstanceOf(UserLogin);
        expect(login.provider).toBe('Google');
    });

    it('includes an enum string converter helper', () => {
        const converter = enumString<'google'>();
        expect(converter.toProvider('google')).toBe('google');
        expect(converter.fromProvider('google')).toBe('google');
    });
});

describe('toStoreValue JSON serialization', () => {
    it('JSON-serializes every shape for a json/jsonb column, keyed on column type', () => {
    // A top-level array would otherwise bind as a native array on Postgres, and
    // a bare boolean as 0/1 on SQLite — so all shapes are serialized here.
        expect(toStoreValue([1, 2, { a: 'b' }], 'jsonb')).toBe('[1,2,{"a":"b"}]');
        expect(toStoreValue(true, 'jsonb')).toBe('true');
        expect(toStoreValue(42, 'json')).toBe('42');
        expect(toStoreValue({ b: 1 }, 'jsonb')).toBe('{"b":1}');
        expect(toStoreValue('hi', 'jsonb')).toBe('"hi"');
    });

    it('passes null through as SQL NULL rather than the JSON string \'null\'', () => {
        expect(toStoreValue(null, 'jsonb')).toBeNull();
        expect(toStoreValue(undefined, 'jsonb')).toBeUndefined();
    });

    it('leaves non-JSON columns untouched, including native array columns', () => {
        expect(toStoreValue('plain', 'text')).toBe('plain');
        expect(toStoreValue(7, 'integer')).toBe(7);
        // A native Postgres array column is a different type; it must not be JSON'd.
        expect(toStoreValue([1, 2, 3], 'text[]')).toEqual([1, 2, 3]);
    });

    it('rejects invalid mapped Date values with property context', () => {
        expect(() => toStoreValue(
            new Date(Number.NaN),
            'timestamptz',
            undefined,
            'AuditRecord.createdAt',
        )).toThrow(
            'Invalid Date at \'AuditRecord.createdAt\'. Mapped Date values must be valid.',
        );
    });

    it('rejects lossy JSON values with mapped-property context', () => {
        expect(() => toStoreValue(
            { user: { profile: new Map([['name', 'Ada']]) } },
            'jsonb',
            undefined,
            'Document.data',
        )).toThrow(
            'Unsupported JSON value at \'Document.data.user.profile\' (Map)',
        );
        expect(() => toStoreValue(
            { score: Number.NaN },
            'json',
            undefined,
            'Document.data',
        )).toThrow('Unsupported JSON value at \'Document.data.score\' (NaN)');
    });
});
