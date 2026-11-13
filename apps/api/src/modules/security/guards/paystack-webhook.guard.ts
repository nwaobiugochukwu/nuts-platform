import { CanActivate, Injectable } from '@nestjs/common';

/**
 * This guard allows the Paystack webhook route to bypass JWT auth.
 * The route should be marked @Public() and this guard ensures no
 * authentication is required.
 */
@Injectable()
export class PaystackWebhookGuard implements CanActivate {
  canActivate(): boolean {
    // Webhook routes are always public — this guard exists as an
    // explicit marker and safety check. It always returns true.
    return true;
  }
}
