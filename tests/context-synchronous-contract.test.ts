import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../src';
import {
    DbContext,
    ModelValidationError,
} from '../src';
import { RecordingDatabaseConnection } from '../src/testing';

class ContractUser {
    public id!: string;
}

class AsyncConfigureContext extends DbContext {
    protected override async configure(
        options: DbContextOptionsBuilder,
    ): Promise<void> {
        await Promise.resolve();
        options.useConnection(new RecordingDatabaseConnection());
    }
}

class AsyncModelContext extends DbContext {
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(new RecordingDatabaseConnection());
    }

    protected override async model(model: ModelBuilder): Promise<void> {
        await Promise.resolve();
        model.entity(ContractUser, entity => {
            entity.toTable('contract_users');
            entity.hasKey(user => user.id);
        });
    }
}

class PartialAsyncModelContext extends DbContext {
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(new RecordingDatabaseConnection());
    }

    protected override async model(model: ModelBuilder): Promise<void> {
        model.entity(ContractUser, entity => {
            entity.toTable('before_await');
            entity.hasKey(user => user.id);
        });
        await Promise.resolve();
        model.entity(class LaterUser {}, entity => {
            entity.toTable('after_await');
            entity.hasNoKey();
        });
    }
}

describe('context synchronous callback contract', () => {
    it('rejects async context configuration before options finalize', () => {
        expect(() => AsyncConfigureContext.create()).toThrow(
            'DbContext.configure() must be synchronous and must not return a Promise.',
        );
    });

    it('rejects async model configuration with a model error', () => {
        expect(() => AsyncModelContext.create()).toThrow(ModelValidationError);
        expect(() => AsyncModelContext.create()).toThrow(
            'DbContext.model() must be synchronous and must not return a Promise.',
        );
    });

    it('never finalizes the synchronous prefix of an async model', () => {
        expect(() => PartialAsyncModelContext.create()).toThrow(
            'DbContext.model() must be synchronous',
        );
    });
});
