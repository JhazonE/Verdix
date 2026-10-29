import { query } from '../../lib/mysql';

export interface Migration {
  name: string;
  timestamp: string;
  up(): Promise<void>;
  down(): Promise<void>;
}

let migrations: Migration[] = [];

export function registerMigration(migration: Migration) {
  migrations.push(migration);
}

/**
 * The names every registered migration would run under, in run order.
 *
 * Importing `scripts/migrations/index` registers them all as a side effect, so
 * this is the only way to ask "what will the new build try to apply?" without
 * applying anything. The upgrade pre-flight check diffs it against the
 * `migrations` table to list what is pending.
 */
export function getRegisteredMigrationNames(): string[] {
  return migrations.map((m) => m.name);
}

export async function createMigrationsTable(): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      timestamp VARCHAR(50) NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await query(sql);
}

export async function getExecutedMigrations(): Promise<Set<string>> {
  const result = await query('SELECT name FROM migrations');
  return new Set(result.map((row: any) => row.name));
}

export async function recordMigration(name: string, timestamp: string): Promise<void> {
  await query('INSERT INTO migrations (name, timestamp) VALUES (?, ?)', [name, timestamp]);
}

export async function removeMigration(name: string): Promise<void> {
  await query('DELETE FROM migrations WHERE name = ?', [name]);
}

export async function migrateUp(): Promise<void> {
  console.log('🔄 Starting database migration...');

  try {
    await createMigrationsTable();
    const executedMigrations = await getExecutedMigrations();

    let executedCount = 0;
    for (const migration of migrations) {
      if (!executedMigrations.has(migration.name)) {
        console.log(`📈 Running migration: ${migration.name}`);
        await migration.up();
        await recordMigration(migration.name, migration.timestamp);
        executedCount++;
        console.log(`✅ Migration ${migration.name} completed`);
      } else {
        console.log(`⏭️  Migration ${migration.name} already executed`);
      }
    }

    console.log(`🎉 Migration complete! Executed ${executedCount} migration(s)`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

export async function migrateDown(): Promise<void> {
  console.log('🔄 Starting rollback...');

  try {
    const executedMigrations = await getExecutedMigrations();

    if (executedMigrations.size === 0) {
      console.log('ℹ️  No migrations to rollback');
      return;
    }

    // Get the last executed migration
    const lastMigration = migrations
      .filter(m => executedMigrations.has(m.name))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];

    if (!lastMigration) {
      console.log('ℹ️  No migrations found to rollback');
      return;
    }

    console.log(`⬇️  Rolling back migration: ${lastMigration.name}`);
    await lastMigration.down();
    await removeMigration(lastMigration.name);
    console.log(`✅ Rollback ${lastMigration.name} completed`);

  } catch (error) {
    console.error('❌ Rollback failed:', error);
    throw error;
  }
}

// CLI runner
async function main() {
  const command = process.argv[2];

  if (command === 'up' || command === undefined) {
    await migrateUp();
  } else if (command === 'down') {
    await migrateDown();
  } else {
    console.log('Usage: tsx scripts/migrations/runner.ts [up|down]');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
