import { currentClient } from '@api/common/request-context/request-context.util';
import { TransactionRunnerService } from '@api/infrastructure/database/transaction-runner.service';
import { DomainEvents } from '@api/infrastructure/messaging/events/domain-events.constants';
import { Injectable, Logger } from '@nestjs/common';
import { describeDevice } from '../utils/device.util';

export interface SignedInCustomer {
  id: string;
  email: string;
  firstName: string | null;
}

/**
 * Remembers which browsers and systems a customer signs in from, and publishes
 * `user.login_from_new_device` when a sign-in comes from one that is new to an account that
 * already has history. The first device ever seen for an account (a new registration, or an
 * existing account the first time after this feature shipped) is recorded without an alert.
 *
 * It never blocks a sign-in: the caller treats a failure here as a log line.
 */
@Injectable()
export class DeviceTrackingService {
  private readonly logger = new Logger(DeviceTrackingService.name);

  constructor(private readonly transactions: TransactionRunnerService) {}

  /** Records the sign-in that is happening in the current request. Returns true for an alert. */
  async recordSignIn(customer: SignedInCustomer): Promise<boolean> {
    const client = currentClient();
    const device = describeDevice(client?.userAgent);
    const ip = client?.ip ?? null;

    try {
      return await this.transactions.run(
        async (ctx) => {
          const knownBefore = await ctx.tx.userKnownDevice.count({
            where: { userId: customer.id },
          });
          const created = await ctx.tx.userKnownDevice.createMany({
            data: [
              {
                userId: customer.id,
                deviceHash: device.hash,
                label: device.label,
                lastIp: ip,
              },
            ],
            skipDuplicates: true,
          });

          if (created.count === 0) {
            await ctx.tx.userKnownDevice.updateMany({
              where: { userId: customer.id, deviceHash: device.hash },
              data: { lastSeenAt: new Date(), lastIp: ip },
            });
            return false;
          }
          if (knownBefore === 0) return false;

          await ctx.publish({
            type: DomainEvents.USER_LOGIN_FROM_NEW_DEVICE,
            aggregate: { type: 'user', id: customer.id },
            actor: { type: 'user', id: customer.id },
            payload: {
              userId: customer.id,
              email: customer.email,
              firstName: customer.firstName,
              device: device.label,
              ip,
              signedInAt: new Date().toISOString(),
            },
          });
          return true;
        },
        { name: 'auth.record-device', preset: 'short' },
      );
    } catch (error) {
      this.logger.warn(
        `Could not record the sign-in device for user ${customer.id}: ${String(error)}`,
      );
      return false;
    }
  }
}
