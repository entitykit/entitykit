import {
    DbContext,
    type DbContextOptionsBuilder,
    type ModelBuilder,
    type UnsafeRawSqlQueryable,
} from 'entitykit';
import type { DatabaseConnection } from 'entitykit/adapter';
import { defineEntityKitConfig } from 'entitykit/cli';
import { Materializer } from 'entitykit/experimental';
import { Migration } from 'entitykit/migrations';
import { mySqlProviderServices } from 'entitykit/mysql';
import { postgresProviderServices } from 'entitykit/postgres';
import { sqliteProviderServices } from 'entitykit/sqlite';
import { RecordingDatabaseConnection } from 'entitykit/testing';
import { generateDbPullCode } from 'entitykit/tooling';

class Widget {
    public id!: string;
    public label!: string;
}

class ConsumerContext extends DbContext {
    public widgets = this.set(Widget);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
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

void query;
void connection;
void config;
void Materializer;
void Migration;
void mySqlProviderServices;
void postgresProviderServices;
void generateDbPullCode;
