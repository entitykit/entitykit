import {
    BaseEntityConfiguration,
    type EntityBuilder,
    ModelValidationError,
} from '../packages/core/src';
import { ModelBuilder } from '../packages/core/src/model/model-builder';

class ContractUser {
    public id!: string;
    public name!: string;
}

class AsyncUserConfiguration extends BaseEntityConfiguration<ContractUser> {
    public readonly entity = ContractUser;

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    public override async configure(
        builder: EntityBuilder<ContractUser>,
    ): Promise<void> {
        await Promise.resolve();
        builder.toTable('contract_users');
    }
}

describe('model synchronous callback contract', () => {
    it('rejects async entity callbacks and invalidates the partial builder', () => {
        const builder = new ModelBuilder();

        expect(() => builder.entity(
            ContractUser,
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            async entity => {
                entity.toTable('before_await');
                entity.hasKey(user => user.id);
                await Promise.resolve();
                entity.property(user => user.name).hasColumnName('after_await');
            },
        )).toThrow(ModelValidationError);
        expect(() => builder.build()).toThrow(
            'ModelBuilder.entity(ContractUser) callback must be synchronous',
        );
    });

    it('rejects async reusable entity configurations', () => {
        expect(() => new ModelBuilder().applyConfiguration(
            new AsyncUserConfiguration(),
        )).toThrow(
            'ModelBuilder.entity(ContractUser) callback must be synchronous',
        );
    });

    it('rejects async sequence configuration before registering it', () => {
        const builder = new ModelBuilder();

        expect(() => builder.hasSequence(
            'contract_numbers',
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            async sequence => {
                sequence.startsAt(10);
                await Promise.resolve();
                sequence.incrementsBy(5);
            },
        )).toThrow(
            'ModelBuilder.hasSequence(contract_numbers) callback must be synchronous',
        );
        expect(() => builder.build()).toThrow(ModelValidationError);
    });

    it('rejects custom thenables but permits fluent return values', () => {
        expect(() => new ModelBuilder().entity(
            ContractUser,
            () => ({ then: (): void => {
                // Shape alone defines a thenable.
            } }),
        )).toThrow('must be synchronous');

        const model = new ModelBuilder().entity(
            ContractUser,
            entity => {
                entity.hasNoKey();
                entity.property(user => user.id).hasColumnType('text');
                return entity.toTable('contract_users');
            },
        ).build();
        expect(model.getEntity(ContractUser).tableName).toBe('contract_users');
    });
});
