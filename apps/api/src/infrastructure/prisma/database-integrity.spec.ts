import * as fs from 'fs';
import * as path from 'path';

describe('Database Schema & Migration Integrity', () => {
  const rootDir = path.resolve(__dirname, '../../../../../');
  const schemaPath = path.join(rootDir, 'packages/database/schema.prisma');
  const migrationsDir = path.join(rootDir, 'packages/database/migrations');

  it('verifies schema.prisma exists and defines all core multi-vendor models', () => {
    expect(fs.existsSync(schemaPath)).toBe(true);
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');

    const expectedModels = [
      'model User',
      'model Vendor',
      'model Product',
      'model ProductVariant',
      'model Category',
      'model Cart',
      'model CartItem',
      'model Order',
      'model OrderItem',
      'model Payment',
      'model UserWallet',
      'model VendorWallet',
      'model DiscountCode',
      'model CheckoutIdempotency',
      'model OutboxEvent',
    ];

    for (const model of expectedModels) {
      expect(schemaContent).toContain(model);
    }
  });

  it('verifies critical unique constraints for data integrity & race condition safety', () => {
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');

    // User email uniqueness
    expect(schemaContent).toMatch(/email\s+String\s+@unique/);

    // Order number uniqueness
    expect(schemaContent).toMatch(/orderNumber\s+String\s+@unique/);

    // Payment transaction reference uniqueness
    expect(schemaContent).toMatch(/transactionReference\s+String\??\s+@unique/);

    // Checkout idempotency compound unique constraint (prevents duplicate orders per key)
    expect(schemaContent).toContain('@@unique([userId, idempotencyKey])');

    // Discount code uniqueness
    expect(schemaContent).toMatch(/code\s+String\s+@unique/);
  });

  it('verifies all migration folders contain non-empty migration.sql files', () => {
    expect(fs.existsSync(migrationsDir)).toBe(true);
    const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
    const migrationDirs = entries.filter((e) => e.isDirectory());

    expect(migrationDirs.length).toBeGreaterThan(0);

    for (const dir of migrationDirs) {
      const sqlFile = path.join(migrationsDir, dir.name, 'migration.sql');
      expect(fs.existsSync(sqlFile)).toBe(true);
      const content = fs.readFileSync(sqlFile, 'utf8');
      expect(content.trim().length).toBeGreaterThan(0);
    }
  });

  it('verifies migration_lock.toml matches PostgreSQL provider', () => {
    const lockFile = path.join(migrationsDir, 'migration_lock.toml');
    expect(fs.existsSync(lockFile)).toBe(true);
    const content = fs.readFileSync(lockFile, 'utf8');
    expect(content).toContain('provider = "postgresql"');
  });
});
