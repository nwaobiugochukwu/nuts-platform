import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type VendorRequestUser = {
  id: string;
  email: string;
  type: 'vendor';
  refreshId?: string;
};

export const GetVendor = createParamDecorator(
  (data: keyof VendorRequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user: VendorRequestUser }>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
