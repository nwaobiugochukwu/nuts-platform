import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from '../../config/env.validation';
import { pinoLoggerConfig } from '../../config/logger.config';
import { PrismaModule } from '../database/prisma.module';
import { SampleActivities } from './activities/sample.activities';

/**
 * A deliberately slim module for the Temporal worker process: it loads only
 * what activities need, not the whole HTTP application. Add the feature
 * modules (and their providers) that new activities depend on here.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot(pinoLoggerConfig()),
    PrismaModule,
  ],
  providers: [SampleActivities],
})
export class TemporalWorkerModule {}
