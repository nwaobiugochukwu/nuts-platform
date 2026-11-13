import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { defineConfig } from 'prisma/config';

// 12-factor environment cascading for Prisma CLI
const rootDir = __dirname;
const env = process.env.NODE_ENV || 'development';
const candidateFiles = [
  `.env.${env}.local`,
  `.env.${env}`,
  '.env.local',
  '.env',
];

for (const file of candidateFiles) {
  const filePath = path.resolve(rootDir, file);
  if (fs.existsSync(filePath)) {
    dotenv.config({ path: filePath });
  }
}

export default defineConfig({
  schema: '../../packages/database/schema.prisma',
  migrations: {
    path: '../../packages/database/migrations',
  },
  datasource: {
    url: process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'],
  },
});
