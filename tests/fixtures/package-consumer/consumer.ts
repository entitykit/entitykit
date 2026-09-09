import './checked-materialization-types.js';
import './context-creation-types.js';
import './factory-creation-types.js';
import './creation-types.js';
// Type-level acceptance for a CommonJS consumer resolving the published
// tarballs under `module: Node16`. Every scoped entry point the release
// promises is imported here, so a missing `exports` condition or a `.d.ts`
// that never shipped fails the package check instead of a user's install.
import {
    DatabaseProviderError,
    DbContext,
    EntityState,
    type DbContextOptionsBuilder,
    type ModelBuilder,
    type UnsafeRawSqlQueryable,
} from '@entitykit/core';
import type { DatabaseConnection } from '@entitykit/core/adapter';
import { Materializer } from '@entitykit/core/experimental';
import { Migration } from '@entitykit/core/migrations';
import { generateDbPullCode } from '@entitykit/core/tooling';
import { defineEntityKitConfig } from '@entitykit/cli';
import { mySqlProviderServices } from '@entitykit/mysql';
import { postgresProviderServices } from '@entitykit/postgres';
import { sqliteProviderServices } from '@entitykit/sqlite';
import { RecordingDatabaseConnection } from '@entitykit/testing';

class Widget {
    public id!: string;
    public label!: string;
}

class ConsumerContext extends DbContext {
    public widgets = this.set(Widget);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
        // @ts-expect-error Provider configuration typos must not cross the public facade.
        options.useProvider(sqliteProviderServices, { filename: ':memory:', filemane: 'typo' });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Widget, entity => {
            entity.toTable('widgets');
            entity.hasKey(widget => widget.id);
            entity.property(widget => widget.id).hasColumnType('text').isRequired();
            entity.property(widget => widget.label).hasColumnType('text').isRequired();
        });
    }
}


const context = ConsumerContext.create();
const query: UnsafeRawSqlQueryable<Widget> =
    context.widgets.fromSqlUnsafe`select id, label from widgets`;
const connection: DatabaseConnection = new RecordingDatabaseConnection();
const config = defineEntityKitConfig({
    context: ConsumerContext,
    provider: sqliteProviderServices,
    connection: ':memory:',
});
const state: EntityState = EntityState.Added;

void query;
void connection;
void config;
void state;
void DatabaseProviderError;
void Materializer;
void Migration;
void mySqlProviderServices;
void postgresProviderServices;
void generateDbPullCode;
