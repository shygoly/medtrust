import type { DataSourceOptions } from "typeorm";

const POSTGRES_URL = /^postgres(ql)?:\/\//;

export function resolveDatabaseOptions(input: {
  variable: string;
  url: string;
  defaultPostgresUrl: string;
  entities: DataSourceOptions["entities"];
  migrations?: string[];
}): DataSourceOptions {
  const url = input.url.trim() || input.defaultPostgresUrl;
  const isPostgres = POSTGRES_URL.test(url);
  const isTest = process.env.NODE_ENV === "test";

  if (!isPostgres && !isTest) {
    throw new Error(
      `${input.variable} must be a postgres:// or postgresql:// URL; SQLite is test-only`,
    );
  }

  if (isPostgres) {
    return {
      type: "postgres",
      url,
      synchronize: process.env.DB_SYNCHRONIZE === "true",
      migrationsRun: process.env.DB_SYNCHRONIZE !== "true",
      migrations: input.migrations ?? ["./migrations/*.ts"],
      entities: input.entities,
      subscribers: [],
      logging: process.env.NODE_ENV === "development",
    };
  }

  return {
    type: "better-sqlite3",
    database: url === input.defaultPostgresUrl ? ":memory:" : url,
    synchronize: true,
    enableWAL: true,
    migrationsRun: false,
    entities: input.entities,
    subscribers: [],
    logging: false,
  };
}
