import type { OnApplicationShutdown } from '@nestjs/common';
import type { EntityKitDataSource } from '@entitykit/core';
import type { EntityKitDataSourceOwnership } from './entity-kit-module-options.js';

/** Bridges Nest application shutdown to EntityKit data-source disposal. */
export class EntityKitDataSourceLifecycle implements OnApplicationShutdown {
    constructor(
        private readonly dataSource: EntityKitDataSource,
        private readonly ownership: EntityKitDataSourceOwnership,
    ) {}

    /** Close provider resources after Nest has stopped accepting work. */
    public async onApplicationShutdown(): Promise<void> {
        if (this.ownership === 'module') {
            await this.dataSource.dispose();
        }
    }
}
