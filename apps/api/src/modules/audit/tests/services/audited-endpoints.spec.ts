import {
  AUDIT_METADATA,
  type AuditOptions,
} from '@api/modules/audit/decorators/audit.decorator';
import { AdminAnnouncementsController } from '../../../announcements/controllers/admin-announcements.controller';
import { AdminPlatformController } from '../../../platform/controllers/admin-platform.controller';
import { AdminStaffController } from '../../../staff/controllers/admin-staff.controller';
import { AdminAuthController } from '../../../auth/controllers/admin-auth.controller';
import { AuthController } from '../../../auth/controllers/auth.controller';
import { AdminCategoryController } from '../../../categories/controllers/admin-category.controller';
import { AdminOrdersController } from '../../../orders/controllers/admin-orders.controller';
import { AdminProductsController } from '../../../products/controllers/admin-products.controller';
import { VendorProductsController } from '../../../products/controllers/vendor-products.controller';
import { AdminUsersController } from '../../../users/controllers/admin-users.controller';
import { UsersController } from '../../../users/controllers/users.controller';
import { AdminVendorsController } from '../../../vendors/controllers/admin-vendors.controller';
import { VendorAccountController } from '../../../vendors/controllers/vendor-account.controller';
import { VendorAuthController } from '../../../auth/controllers/vendor-auth.controller';

/**
 * Every endpoint that records an audit event, with its action. Audit used to be
 * written inline in services; it now lives on the controller method with
 * `@Audit(...)`. If you remove a decorator, or add an audited endpoint, this
 * list must change with it, so an audit trail cannot be dropped by accident.
 */
const AUDITED_ENDPOINTS: Array<
  [new (...args: never[]) => object, Array<[string, string]>]
> = [
  [
    AdminAnnouncementsController,
    [
      ['create', 'ANNOUNCEMENT_DRAFT_CREATED'],
      ['update', 'ANNOUNCEMENT_DRAFT_UPDATED'],
      ['publish', 'ANNOUNCEMENT_PUBLISH_STARTED'],
      ['schedule', 'ANNOUNCEMENT_SCHEDULED'],
      ['archive', 'ANNOUNCEMENT_ARCHIVED'],
    ],
  ],
  [
    AdminPlatformController,
    [['updatePlatformConfig', 'PLATFORM_CONFIG_UPDATED']],
  ],
  [
    AdminStaffController,
    [
      ['createStaff', 'ADMIN_STAFF_CREATED'],
      ['updateStaffStatus', 'ADMIN_STAFF_ACTIVATED'],
    ],
  ],
  [
    AdminAuthController,
    [
      ['setup', 'ADMIN_SETUP'],
      ['logout', 'ADMIN_LOGOUT'],
    ],
  ],
  [
    AuthController,
    [
      ['googleAuth', 'USER_GOOGLE_LOGIN'],
      ['googleRegister', 'USER_GOOGLE_LOGIN'],
      ['register', 'USER_REGISTER'],
      ['logout', 'USER_LOGOUT'],
      ['logoutAll', 'USER_LOGOUT_ALL'],
      ['resetPassword', 'USER_RESET_PASSWORD'],
    ],
  ],
  [
    AdminCategoryController,
    [
      ['create', 'CATEGORY_CREATED'],
      ['update', 'CATEGORY_UPDATED'],
      ['move', 'CATEGORY_UPDATED'],
      ['reorder', 'CATEGORIES_REORDERED'],
      ['activate', 'CATEGORY_ACTIVATED'],
      ['deactivate', 'CATEGORY_DEACTIVATED'],
      ['archive', 'CATEGORY_ARCHIVED'],
      ['restore', 'CATEGORY_RESTORED'],
      ['remove', 'CATEGORY_DELETED'],
    ],
  ],
  [AdminOrdersController, [['updateStatus', 'UPDATE_ORDER_STATUS']]],
  [
    AdminProductsController,
    [
      ['create', 'CREATE_PRODUCT'],
      ['updateStock', 'UPDATE_PRODUCT_STOCK'],
      ['update', 'UPDATE_PRODUCT'],
      ['deactivate', 'DEACTIVATE_PRODUCT'],
      ['reactivate', 'REACTIVATE_PRODUCT'],
      ['remove', 'PERMANENT_DELETE_PRODUCT'],
    ],
  ],
  [
    VendorProductsController,
    [
      ['create', 'CREATE_PRODUCT'],
      ['update', 'UPDATE_PRODUCT'],
      ['updateStock', 'UPDATE_PRODUCT_STOCK'],
      ['deactivate', 'DEACTIVATE_PRODUCT'],
      ['reactivate', 'REACTIVATE_PRODUCT'],
      ['permanentRemove', 'PERMANENT_DELETE_PRODUCT'],
    ],
  ],
  [
    AdminUsersController,
    [
      ['adminSuspend', 'ADMIN_SUSPEND_USER'],
      ['adminUnsuspend', 'ADMIN_UNSUSPEND_USER'],
      ['deleteUser', 'ADMIN_SOFT_DELETE_USER'],
    ],
  ],
  [
    UsersController,
    [
      ['updateProfile', 'UPDATE_PROFILE'],
      ['changePassword', 'CHANGE_PASSWORD'],
      ['deactivateAccount', 'SELF_DEACTIVATE_USER'],
      ['reactivate', 'SELF_REACTIVATE_USER'],
      ['permanentDelete', 'SELF_PERMANENT_DELETE_USER'],
    ],
  ],
  [
    AdminVendorsController,
    [
      ['approve', 'APPROVE_VENDOR'],
      ['verify', 'VERIFY_VENDOR'],
      ['deactivate', 'DEACTIVATE_VENDOR'],
      ['reactivate', 'REACTIVATE_VENDOR'],
      ['delete', 'DELETE_VENDOR'],
    ],
  ],
  [
    VendorAccountController,
    [
      ['updateProfile', 'VENDOR_UPDATE_PROFILE'],
      ['reactivate', 'VENDOR_SELF_REACTIVATE'],
      ['deactivateProfile', 'VENDOR_SELF_DEACTIVATE'],
      ['deleteProfile', 'VENDOR_SELF_DELETE'],
    ],
  ],
  [
    VendorAuthController,
    [
      ['register', 'VENDOR_REGISTER'],
      ['googleAuth', 'VENDOR_GOOGLE_LOGIN'],
      ['googleRegister', 'VENDOR_GOOGLE_LOGIN'],
      ['logout', 'VENDOR_LOGOUT'],
      ['resetPassword', 'VENDOR_RESET_PASSWORD'],
    ],
  ],
];

describe('audited endpoints', () => {
  it.each(AUDITED_ENDPOINTS)(
    '%p records its actions',
    (controller, endpoints) => {
      for (const [method, action] of endpoints) {
        const handler = (controller.prototype as Record<string, unknown>)[
          method
        ];
        const options = Reflect.getMetadata(
          AUDIT_METADATA,
          handler as object,
        ) as AuditOptions | undefined;
        expect({ method, action: options?.action }).toEqual({ method, action });
      }
    },
  );

  it('lists every endpoint that has @Audit', () => {
    const listed = AUDITED_ENDPOINTS.reduce((n, [, e]) => n + e.length, 0);
    expect(listed).toBe(60);
  });
});
