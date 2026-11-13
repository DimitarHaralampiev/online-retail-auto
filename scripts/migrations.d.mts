export function migrationFiles(): Promise<string[]>;
export function applyMigrations(
  connectionString: string,
  options?: { log?: (message: string) => void },
): Promise<void>;
