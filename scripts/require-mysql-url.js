const databaseUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;

if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
  console.error("MYSQL_URL is required to run live MySQL integration tests.");
  console.error(
    "Example: MYSQL_URL=mysql://root:password@localhost:3306/entitykit npm run test:integration:mysql"
  );
  process.exit(1);
}
