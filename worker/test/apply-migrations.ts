import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

const testEnv = env as unknown as { DB: D1Database; TEST_MIGRATIONS: never };
await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
