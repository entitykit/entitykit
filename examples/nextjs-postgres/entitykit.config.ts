import { defineEntityKitConfig } from "@entitykit/core";
import { postgresProviderServices } from "@entitykit/postgres";
import { loadEnvConfig } from "@next/env";
import { databaseUrl } from "./src/db/environment";
import { MigrationDbContext } from "./src/db/publication-db-context";

loadEnvConfig(process.cwd());

export default defineEntityKitConfig({
  context: MigrationDbContext,
  provider: postgresProviderServices,
  connection: () => ({
    connectionString: databaseUrl(),
    applicationName: "entitykit-nextjs-demo-migrations",
    pool: { max: 1, allowExitOnIdle: true },
  }),
  migrationsDir: "src/db/migrations",
});
