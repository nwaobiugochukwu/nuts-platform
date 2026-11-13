import { SetMetadata } from '@nestjs/common';

export const BYPASS_RESPONSE_INTERCEPTOR_KEY = 'bypassResponseInterceptor';

export const BypassResponseInterceptor = () =>
  SetMetadata(BYPASS_RESPONSE_INTERCEPTOR_KEY, true);
