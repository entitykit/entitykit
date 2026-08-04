import type { ValueConverter } from '../src';
import type { EntityMetadata } from '../src/model/entity-metadata';
import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import { createQueryModel, createQueryProxy } from '../src/experimental';
import { ModificationSqlBuilder } from '../src/sql/modification-sql-builder';
import { SelectSqlBuilder } from '../src/sql/select-sql-builder';
import { SaveTimeMutationLog } from '../src/core/save-time-mutations';
import { writeGeneratedValue } from '../src/core/unit-of-work/generated-value-writer';

interface ConverterControl {
    toAsync: boolean;
    fromAsync: boolean;
    readonly converter: ValueConverter;
}

async function resolvedLater(value: unknown): Promise<unknown> {
    await Promise.resolve();
    return value;
}

function controlledConverter(prefix: string): ConverterControl {
    const control: ConverterControl = {
        toAsync: false,
        fromAsync: false,
        converter: {
            toProvider(value): unknown {
                const converted = `${prefix}${String(value)}`;
                return control.toAsync ? resolvedLater(converted) : converted;
            },
            fromProvider(value): unknown {
                const converted = String(value).replace(prefix, '');
                return control.fromAsync ? resolvedLater(converted) : converted;
            },
        },
    };
    return control;
}

class ConverterParent {
    public id!: string;
}

class ConverterRecord {
    public id!: string;
    public parentId!: string;
    public parent!: ConverterParent;
    public code!: string;
    public version!: string;
    public generated!: string;
}

const id = controlledConverter('id:');
const parentId = controlledConverter('parent:');
const code = controlledConverter('code:');
const version = controlledConverter('version:');
const generated = controlledConverter('generated:');

function createMetadata(): EntityMetadata<ConverterRecord> {
    const model = new ModelBuilderImplementation();
    model.entity(ConverterParent, entity => {
        entity.toTable('converter_parents');
        entity.hasKey(parent => parent.id);
        entity.property(parent => parent.id)
            .hasColumnName('id').hasColumnType('text').isRequired();
    });
    model.entity(ConverterRecord, entity => {
        entity.toTable('converter_records');
        entity.hasKey(record => record.id);
        entity.property(record => record.id)
            .hasColumnName('id').hasColumnType('text').isRequired()
            .hasConversion(id.converter as ValueConverter<string>);
        entity.property(record => record.parentId)
            .hasColumnName('parent_id').hasColumnType('text').isRequired()
            .hasConversion(parentId.converter as ValueConverter<string>);
        entity.property(record => record.code)
            .hasColumnName('code').hasColumnType('text').isRequired()
            .hasConversion(code.converter as ValueConverter<string>);
        entity.property(record => record.version)
            .hasColumnName('version').hasColumnType('text').isRequired()
            .hasConversion(version.converter as ValueConverter<string>)
            .isConcurrencyToken();
        entity.property(record => record.generated)
            .hasColumnName('generated').hasColumnType('text').isRequired()
            .hasConversion(generated.converter as ValueConverter<string>)
            .valueGeneratedOnAddOrUpdate();
        entity.hasOne(ConverterParent, record => record.parent)
            .withMany()
            .hasForeignKey(record => record.parentId);
    });
    return model.build().getEntity(ConverterRecord);
}

function record(): ConverterRecord {
    return Object.assign(new ConverterRecord(), {
        id: 'record_1',
        parentId: 'parent_1',
        code: 'active',
        version: 'v1',
        generated: 'server',
    });
}

describe('value converter path guards', () => {
    const metadata = createMetadata();
    const modification = new ModificationSqlBuilder();

    beforeEach(() => {
        for (const control of [id, parentId, code, version, generated]) {
            control.toAsync = false;
            control.fromAsync = false;
        }
    });

    it('guards primary-key and foreign-key conversion', () => {
        id.toAsync = true;
        expect(() => modification.buildDelete(metadata, record())).toThrow(
            'ValueConverter.toProvider() must be synchronous',
        );

        id.toAsync = false;
        parentId.toAsync = true;
        expect(() => modification.buildInsert(metadata, record())).toThrow(
            'ValueConverter.toProvider() must be synchronous',
        );
    });

    it('guards predicate parameter conversion', () => {
        const proxy = createQueryProxy<ConverterRecord>();
        const query = {
            ...createQueryModel(ConverterRecord),
            predicate: proxy.code.eq('active'),
        };
        code.toAsync = true;

        expect(() => new SelectSqlBuilder().build(metadata, query)).toThrow(
            'ValueConverter.toProvider() must be synchronous',
        );
    });

    it('guards concurrency-token conversion', () => {
        version.toAsync = true;

        expect(() => modification.buildUpdate(
            metadata,
            record(),
            ['code'],
            { version: 'v1' },
        )).toThrow('ValueConverter.toProvider() must be synchronous');
    });

    it('guards bulk-update and upsert conversion', () => {
        const proxy = createQueryProxy<ConverterRecord>();
        code.toAsync = true;
        expect(() => modification.buildBulkUpdate(metadata, {
            values: { code: 'archived' },
            predicate: proxy.id.eq('record_1').node,
        })).toThrow('ValueConverter.toProvider() must be synchronous');

        code.toAsync = false;
        parentId.toAsync = true;
        expect(() => modification.buildUpsertBatch(metadata, [record()]))
            .toThrow('ValueConverter.toProvider() must be synchronous');
    });

    it('guards generated-value conversion before mutating the entity', () => {
        const entity = record();
        generated.fromAsync = true;

        expect(() => writeGeneratedValue(
            entity,
            metadata.getProperty('generated'),
            'generated:database',
            new SaveTimeMutationLog(),
        )).toThrow('ValueConverter.fromProvider() must be synchronous');
        expect(entity.generated).toBe('server');
    });
});
