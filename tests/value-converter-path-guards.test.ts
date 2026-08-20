import type { ValueConverter } from '../packages/core/src';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import { createQueryModel, createQueryProxy } from '../packages/core/src/experimental';
import { ModificationSqlBuilder } from '../packages/core/src/sql/modification-sql-builder';
import { SelectSqlBuilder } from '../packages/core/src/sql/select-sql-builder';
import { SaveTimeMutationLog } from '../packages/core/src/core/save-time-mutations';
import { writeGeneratedValue } from '../packages/core/src/core/unit-of-work/generated-value-writer';
import { RestorationScope } from '../packages/core/src/restoration-scope';

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
            'Value converter for \'ConverterRecord.id\' toProvider()',
        );

        id.toAsync = false;
        parentId.toAsync = true;
        expect(() => modification.buildInsert(metadata, record())).toThrow(
            'Value converter for \'ConverterRecord.parentId\' toProvider()',
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
            'Value converter for \'ConverterRecord.code\' toProvider()',
        );
    });

    it('guards concurrency-token conversion', () => {
        version.toAsync = true;

        expect(() => modification.buildUpdate(
            metadata,
            record(),
            ['code'],
            { version: 'v1' },
        )).toThrow('Value converter for \'ConverterRecord.version\' toProvider()');
    });

    it('guards bulk-update and upsert conversion', () => {
        const proxy = createQueryProxy<ConverterRecord>();
        code.toAsync = true;
        expect(() => modification.buildBulkUpdate(metadata, {
            values: { code: 'archived' },
            predicate: proxy.id.eq('record_1').node,
        })).toThrow('Value converter for \'ConverterRecord.code\' toProvider()');

        code.toAsync = false;
        parentId.toAsync = true;
        expect(() => modification.buildUpsertBatch(metadata, [record()]))
            .toThrow('Value converter for \'ConverterRecord.parentId\' toProvider()');
    });

    it('guards generated-value conversion before mutating the entity', () => {
        const entity = record();
        generated.fromAsync = true;

        expect(() => writeGeneratedValue(
            entity,
            metadata.getProperty('generated'),
            'generated:database',
            new SaveTimeMutationLog(),
            new RestorationScope(() => undefined),
            undefined,
            metadata as unknown as EntityMetadata,
        )).toThrow('Value converter for \'ConverterRecord.generated\' fromProvider()');
        expect(entity.generated).toBe('server');
    });
});
