import { SetMetadata } from '@nestjs/common';
import type { RegistrationKind } from '@api/common/guards/registrations.guard';
import { REGISTRATION_TYPE_KEY } from '@api/common/guards/registrations.guard';

/**
 * Marks a route handler as a registration endpoint and declares
 * which kind of registration it handles.
 *
 * The `RegistrationsGuard` reads this metadata to decide whether
 * to allow or block the request based on the platform configuration.
 *
 * @example
 * // Customer registration — blocked when allowRegistrations = false
 * @Post('register')
 * @RegistrationType('user')
 * @UseGuards(RegistrationsGuard)
 * register(@Body() dto: RegisterDto) { … }
 *
 * @example
 * // Vendor registration — blocked when allowVendorRegistrations = false
 * @Post('register')
 * @RegistrationType('vendor')
 * @UseGuards(RegistrationsGuard)
 * register(@Body() dto: CreateVendorDto) { … }
 */
export const RegistrationType = (kind: RegistrationKind) =>
  SetMetadata(REGISTRATION_TYPE_KEY, kind);
