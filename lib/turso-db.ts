import { createClient, type Client, type InStatement, type ResultSet } from "@libsql/client";

type D1Result<T = Record<string, unknown>> = {
  results: T[];
  meta: { changes: number; last_row_id: number };
};

class TursoStatement {
  private readonly statement: InStatement;

  constructor(private readonly client: Client, sql: string, args: unknown[] = []) {
    this.statement = { sql, args: args as InStatement["args"] };
  }

  bind(...args: unknown[]) {
    return new TursoStatement(this.client, this.statement.sql, args);
  }

  private async execute(): Promise<ResultSet> {
    return this.client.execute(this.statement);
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.execute();
    return { results: result.rows as T[], meta: resultToMeta(result) };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const result = await this.execute();
    return (result.rows[0] as T | undefined) ?? null;
  }

  async run(): Promise<D1Result> {
    const result = await this.execute();
    return { results: [], meta: resultToMeta(result) };
  }
}

function resultToMeta(result: ResultSet) {
  return {
    changes: Number(result.rowsAffected ?? 0),
    last_row_id: Number(result.lastInsertRowid ?? 0),
  };
}

class TursoDatabase {
  constructor(private readonly client: Client) {}

  prepare(sql: string) {
    return new TursoStatement(this.client, sql);
  }

  async batch(statements: TursoStatement[]) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

let database: TursoDatabase | null = null;

export function getDatabase() {
  if (database) return database;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.");
  }
  database = new TursoDatabase(createClient({ url, authToken }));
  return database;
}
