import type { EntityKitDataSource } from '../packages/core/src';
import { EntityKitDataSourceLifecycle } from
    '../packages/nestjs/src/entity-kit-data-source-lifecycle';

function dataSource(dispose: jest.Mock<Promise<void>, []>): EntityKitDataSource {
    return { dispose } as unknown as EntityKitDataSource;
}

describe('EntityKitDataSourceLifecycle', () => {
    it('disposes a module-owned data source during application shutdown', async () => {
        const dispose = jest.fn<Promise<void>, []>().mockResolvedValue();
        const lifecycle = new EntityKitDataSourceLifecycle(dataSource(dispose), 'module');

        await lifecycle.onApplicationShutdown();

        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('leaves an externally owned data source open', async () => {
        const dispose = jest.fn<Promise<void>, []>().mockResolvedValue();
        const lifecycle = new EntityKitDataSourceLifecycle(dataSource(dispose), 'external');

        await lifecycle.onApplicationShutdown();

        expect(dispose).not.toHaveBeenCalled();
    });
});
