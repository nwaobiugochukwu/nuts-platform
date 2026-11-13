// users.service.ts

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ROLE } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import {
  AuditLogService,
  toAuditPayload,
  type AuditChanges,
} from '@api/common/audit-log/audit-log.service';
import { BCRYPT_COST_FACTOR } from '@api/common/constants/bcrypt.constants';
import { DEFAULT_ACCOUNT_DELETION_GRACE_DAYS } from './constants/account-lifecycle.constants';

import { AdminSuspendDto } from './dto/admin-suspend.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeactivateAccountResponseDto } from './dto/deactivate-account-response.dto';
import { QueryUserDto } from './dto/query-user.dto';
import { SuspendUserResponseDto } from './dto/suspend-user-response.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserListItemResponseDto } from './dto/user-list-item-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import {
  calculateSuspensionExpiry,
  formatSuspensionReason,
} from './utils/suspension.util';

import { PaginationMetaDto } from '@api/common/dto/pagination-meta.dto';
import {
  buildCursorMeta,
  buildCursorWhere,
  getCursorPagination,
} from '@api/common/utils/cursor-pagination.util';
import { createPaginationMeta } from '@api/common/utils/pagination-meta.util';
import { getPagination } from '@api/common/utils/pagination.util';

const USER_ACTIVE_CACHE_TTL = 45;
const PURGE_BATCH_SIZE = 100;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  private readonly profileSelect = {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    phone: true,
    isEmailVerified: true,
    createdAt: true,
    shippingAddresses: {
      where: {
        isDefault: true,
      },
      take: 1,
      select: {
        id: true,
        fullName: true,
        phone: true,
        street: true,
        city: true,
        state: true,
        country: true,
        isDefault: true,
      },
    },
  } as const;

  private readonly userSelect = {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    phone: true,
    isEmailVerified: true,
    isActive: true,
    deactivatedAt: true,
    scheduledPermanentDeleteAt: true,
    createdAt: true,
    updatedAt: true,
    shippingAddresses: {
      where: {
        isDefault: true,
      },
      take: 1,
      select: {
        id: true,
        fullName: true,
        phone: true,
        street: true,
        city: true,
        state: true,
        country: true,
        isDefault: true,
      },
    },
    referralCode: {
      select: {
        code: true,
      },
    },
  } as const;

  private readonly userListSelect = {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    phone: true,
    isEmailVerified: true,
    isActive: true,
    deactivatedAt: true,
    scheduledPermanentDeleteAt: true,
    deactivatedBy: true,
    deactivationReason: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findOne(userId: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: this.profileSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toResponseDto(user);
  }

  async findAll(query: QueryUserDto): Promise<{
    data: UserListItemResponseDto[];
    meta:
      | PaginationMetaDto
      | ReturnType<typeof buildCursorMeta<UserListItemResponseDto>>;
  }> {
    const { page = 1, limit = 10, search, status, isActive, cursor } = query;

    const where: Prisma.UserWhereInput = {};

    if (status === 'ACTIVE') {
      where.isActive = true;
    } else if (status === 'INACTIVE') {
      where.isActive = false;
      where.deactivatedBy = null;
    } else if (status === 'BANNED' || status === 'SUSPENDED') {
      where.isActive = false;
      where.deactivatedBy = {
        not: null,
      };
    } else if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const trimmedSearch = search?.trim();

    if (trimmedSearch) {
      where.OR = [
        {
          email: {
            contains: trimmedSearch,
            mode: 'insensitive',
          },
        },
        {
          firstName: {
            contains: trimmedSearch,
            mode: 'insensitive',
          },
        },
        {
          lastName: {
            contains: trimmedSearch,
            mode: 'insensitive',
          },
        },
        {
          phone: {
            contains: trimmedSearch,
            mode: 'insensitive',
          },
        },
      ];
    }

    const select = {
      ...this.userListSelect,
      deactivatedBy: true,
    } as const;

    if (cursor) {
      const { take, decodedCursor } = getCursorPagination(limit, cursor);

      const cursorWhere = decodedCursor
        ? buildCursorWhere(decodedCursor, 'desc')
        : [];

      const users = await this.prisma.user.findMany({
        where: {
          ...where,
          ...(cursorWhere.length > 0
            ? {
                AND: cursorWhere,
              }
            : {}),
        },
        select,
        orderBy: [
          {
            createdAt: 'desc',
          },
          {
            id: 'desc',
          },
        ],
        take,
      });

      const data = users.slice(0, limit) as UserListItemResponseDto[];

      const meta = buildCursorMeta(data, limit, (last) => ({
        createdAt: last.createdAt,
        id: last.id,
      }));

      return {
        data,
        meta,
      };
    }

    /*
     * Count and page query are independent and therefore run concurrently.
     * This keeps the normal page-based endpoint from paying the latency of
     * two sequential database round trips.
     */
    const [total, users] = await Promise.all([
      this.prisma.user.count({
        where,
      }),
      this.prisma.user.findMany({
        where,
        ...getPagination(page, limit),
        select,
        orderBy: {
          createdAt: 'desc',
        },
      }),
    ]);

    return {
      data: users,
      meta: createPaginationMeta(total, page, limit),
    };
  }

  async update(
    userId: string,
    dto: UpdateUserDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<UserResponseDto> {
    const existing = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!existing) {
      throw new NotFoundException('User not found');
    }

    this.assertAccountCanBeModified(
      existing.isActive,
      existing.scheduledPermanentDeleteAt,
    );

    const data: Prisma.UserUpdateInput = {};

    /*
     * Only include fields that were supplied by the client.
     * This avoids accidental overwrites and makes the audit diff precise.
     */
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        data[key as keyof Prisma.UserUpdateInput] = value as never;
      }
    }

    const effectivePhone = dto.phone ?? dto.phoneNumber;
    if (effectivePhone !== undefined) {
      data.phone = effectivePhone;
    }
    delete (data as Record<string, unknown>).phoneNumber;

    if (dto.email && dto.email.trim().toLowerCase() !== existing.email) {
      const normalizedEmail = dto.email.trim().toLowerCase();

      const taken = await this.prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
        select: {
          id: true,
        },
      });

      if (taken && taken.id !== userId) {
        throw new ConflictException('Email is already in use');
      }

      data.email = normalizedEmail;
    }

    if (Object.keys(data).length === 0) {
      const unchanged = await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: this.userSelect,
      });

      if (!unchanged) {
        throw new NotFoundException('User not found');
      }

      return this.toResponseDto(unchanged);
    }

    let updatedUser;

    try {
      updatedUser = await this.prisma.user.update({
        where: {
          id: userId,
        },
        data,
        select: this.userSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already in use');
      }

      throw error;
    }

    const changedFields: AuditChanges = {};

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) {
        continue;
      }

      const oldValue = existing[key as keyof typeof existing];

      if (oldValue !== value) {
        const safeOld =
          oldValue instanceof Date
            ? oldValue.toISOString()
            : (oldValue ?? null);
        const safeNew =
          value instanceof Date
            ? value.toISOString()
            : (value as AuditChanges[string]['new']);

        changedFields[key] = {
          old: safeOld,
          new: safeNew,
        };
      }
    }

    if (Object.keys(changedFields).length > 0) {
      await this.auditLog.log({
        action: 'UPDATE_PROFILE',
        entity: 'User',
        entityId: userId,
        userId,
        payload: toAuditPayload({
          changes: changedFields,
        }),
        ipAddress,
        userAgent,
      });
    }

    return this.toResponseDto(updatedUser);
  }

  private toResponseDto(user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    isEmailVerified?: boolean | null;
    createdAt: Date;
    shippingAddresses: Array<{
      id: string;
      fullName: string;
      phone: string;
      street: string;
      city: string;
      state: string;
      country: string;
      isDefault: boolean;
    }>;
    referralCode?: { code: string } | null;
  }): UserResponseDto {
    const defaultAddress = user.shippingAddresses[0] ?? null;
    const verified = user.isEmailVerified ?? false;

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phone,
      isEmailVerified: verified,
      isVerified: verified,
      createdAt: user.createdAt,
      referralCode: user.referralCode?.code ?? null,
      shippingInformation: defaultAddress
        ? {
            id: defaultAddress.id,
            fullName: defaultAddress.fullName,
            phone: defaultAddress.phone,
            street: defaultAddress.street,
            city: defaultAddress.city,
            state: defaultAddress.state,
            country: defaultAddress.country,
            isDefault: true,
          }
        : null,
    };
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        password: true,
        isActive: true,
        scheduledPermanentDeleteAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    this.assertAccountCanBeModified(
      user.isActive,
      user.scheduledPermanentDeleteAt,
    );

    if (!user.password) {
      throw new BadRequestException(
        'Cannot change password for accounts registered via Google Sign-In.',
      );
    }

    const currentPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.password,
    );

    if (!currentPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const samePassword = await bcrypt.compare(dto.newPassword, user.password);

    if (samePassword) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const password = await bcrypt.hash(dto.newPassword, BCRYPT_COST_FACTOR);

    await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        password,
        refreshToken: null,
        refreshTokenId: null,
        tokenVersion: { increment: 1 },
      },
    });

    await this.auditLog.log({
      action: 'CHANGE_PASSWORD',
      entity: 'User',
      entityId: userId,
      userId,
      ipAddress,
      userAgent,
    });
  }

  async deactivate(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<DeactivateAccountResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isActive) {
      throw new BadRequestException('Account is already deactivated');
    }

    if (user.role === ROLE.ADMIN) {
      throw new ConflictException('Admin accounts cannot be self-deactivated');
    }

    const scheduledPermanentDeleteAt = this.computeScheduledDeletionDate();

    const updated = await this.prisma.user.updateMany({
      where: {
        id: userId,
        isActive: true,
      },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
        scheduledPermanentDeleteAt,
        deactivatedBy: null,
        deactivationReason: null,
        refreshToken: null,
        refreshTokenId: null,
        tokenVersion: { increment: 1 },
      },
    });

    if (updated.count !== 1) {
      throw new BadRequestException(
        'Account state changed before deactivation could be completed',
      );
    }

    await this.invalidateActiveAccountCache(userId);

    await this.auditLog.log({
      action: 'SELF_DEACTIVATE_USER',
      entity: 'User',
      entityId: userId,
      userId,
      ipAddress,
      userAgent,
    });

    const graceDays = this.getDeletionGraceDays();

    return {
      message: `Account deactivated. It will be permanently deleted after ${graceDays} days unless you sign in again to reactivate.`,
      scheduledPermanentDeleteAt,
    };
  }

  async reactivate(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<UserResponseDto> {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

    if (
      !user ||
      !user.password ||
      !(await bcrypt.compare(password, user.password))
    ) {
      throw new BadRequestException('Invalid email or password');
    }

    if (user.isActive) {
      throw new BadRequestException('Account is already active');
    }

    if (this.isPastPermanentDeletion(user.scheduledPermanentDeleteAt)) {
      throw new BadRequestException(
        'Account grace period has ended and can no longer be reactivated',
      );
    }

    if (user.deactivatedBy) {
      throw new BadRequestException(
        'Your account was deactivated by an admin. Please contact support to reactivate.',
      );
    }

    const updatedUser = await this.prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        isActive: true,
        deactivatedAt: null,
        scheduledPermanentDeleteAt: null,
        deactivatedBy: null,
        deactivationReason: null,
        tokenVersion: { increment: 1 },
      },
      select: this.userSelect,
    });

    await this.invalidateActiveAccountCache(user.id);

    await this.auditLog.log({
      action: 'SELF_REACTIVATE_USER',
      entity: 'User',
      entityId: user.id,
      userId: user.id,
      ipAddress,
      userAgent,
    });

    return this.toResponseDto(updatedUser);
  }

  async permanentDelete(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        role: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === ROLE.ADMIN) {
      throw new ConflictException('Cannot permanently delete an admin account');
    }

    await this.prisma.user.delete({
      where: {
        id: userId,
      },
    });

    await this.invalidateActiveAccountCache(userId);

    await this.auditLog.log({
      action: 'SELF_PERMANENT_DELETE_USER',
      entity: 'User',
      entityId: userId,
      userId,
      ipAddress,
      userAgent,
    });
  }

  async adminSuspend(
    adminId: string,
    userId: string,
    dtoOrReason: AdminSuspendDto | string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<SuspendUserResponseDto> {
    const reason =
      typeof dtoOrReason === 'string' ? dtoOrReason : dtoOrReason.reason;
    const duration =
      typeof dtoOrReason === 'object' ? dtoOrReason.duration : undefined;
    const suspendedUntilIso =
      typeof dtoOrReason === 'object' ? dtoOrReason.suspendedUntil : undefined;

    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        role: true,
        isActive: true,
        deactivatedBy: true,
        deactivationReason: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isActive) {
      throw new BadRequestException(
        'Account is already suspended or deactivated',
      );
    }

    if (user.role === ROLE.ADMIN) {
      throw new ConflictException('Cannot suspend an admin account');
    }

    const suspendedUntil = calculateSuspensionExpiry(
      duration,
      suspendedUntilIso,
    );
    const isIndefinite = !suspendedUntil;
    const formattedReason = formatSuspensionReason(reason, suspendedUntil);

    const updated = await this.prisma.user.updateMany({
      where: {
        id: userId,
        isActive: true,
      },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
        scheduledPermanentDeleteAt: null,
        deactivatedBy: adminId,
        deactivationReason: formattedReason,
        refreshToken: null,
        refreshTokenId: null,
        tokenVersion: { increment: 1 },
      },
    });

    if (updated.count !== 1) {
      throw new BadRequestException(
        'Account state changed before suspension could be completed',
      );
    }

    // Revoke all active user sessions immediately
    await this.prisma.userAuthSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.invalidateActiveAccountCache(userId);

    await this.auditLog.log({
      action: 'ADMIN_SUSPEND_USER',
      entity: 'User',
      entityId: userId,
      adminId,
      payload: toAuditPayload({
        reason,
        duration: duration ?? (isIndefinite ? 'indefinite' : 'custom'),
        suspendedUntil: suspendedUntil?.toISOString() ?? null,
        isIndefinite,
      }),
      ipAddress,
      userAgent,
    });

    const message = suspendedUntil
      ? `Account suspended until ${suspendedUntil.toUTCString()}. Reason: ${reason}`
      : `Account suspended indefinitely. Reason: ${reason}`;

    return {
      message,
      suspendedUntil,
      isIndefinite,
      reason,
    };
  }

  // Alias for backward compatibility
  async adminDeactivate(
    adminId: string,
    userId: string,
    dtoOrReason: AdminSuspendDto | string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<SuspendUserResponseDto> {
    return this.adminSuspend(
      adminId,
      userId,
      dtoOrReason,
      ipAddress,
      userAgent,
    );
  }

  async adminUnsuspend(
    userId: string,
    adminId?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        isActive: true,
        scheduledPermanentDeleteAt: true,
        deactivatedBy: true,
        deactivationReason: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.isActive) {
      throw new BadRequestException('Account is already active');
    }

    const updatedUser = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        isActive: true,
        deactivatedAt: null,
        scheduledPermanentDeleteAt: null,
        deactivatedBy: null,
        deactivationReason: null,
        tokenVersion: { increment: 1 },
      },
      select: this.userSelect,
    });

    await this.invalidateActiveAccountCache(userId);

    await this.auditLog.log({
      action: 'ADMIN_UNSUSPEND_USER',
      entity: 'User',
      entityId: userId,
      adminId,
      payload: toAuditPayload({
        previousReason: user.deactivationReason,
      }),
      ipAddress,
      userAgent,
    });

    return this.toResponseDto(updatedUser);
  }

  // Alias for backward compatibility
  async adminReactivate(
    userId: string,
    adminId?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<UserResponseDto> {
    return this.adminUnsuspend(userId, adminId, ipAddress, userAgent);
  }

  async permanentRemove(
    userId: string,
    adminId?: string,
    ipAddress?: string,
    userAgent?: string,
    preloadedUser?: {
      id?: string;
      role: ROLE;
      orders: { id: string }[];
      carts: { id: string }[];
      payments: { id: string }[];
    },
  ): Promise<void> {
    const user =
      preloadedUser ??
      (await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          id: true,
          role: true,
          orders: {
            select: {
              id: true,
            },
            take: 1,
          },
          carts: {
            select: {
              id: true,
            },
            take: 1,
          },
          payments: {
            select: {
              id: true,
            },
            take: 1,
          },
        },
      }));

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === ROLE.ADMIN) {
      throw new ConflictException('Cannot permanently delete an admin account');
    }

    this.assertNoRelatedRecords(user);

    await this.prisma.user.delete({
      where: {
        id: userId,
      },
    });

    await this.invalidateActiveAccountCache(userId);

    await this.auditLog.log({
      action: 'ADMIN_PERMANENT_DELETE_USER',
      entity: 'User',
      entityId: userId,
      adminId,
      ipAddress,
      userAgent,
    });
  }

  async adminSoftDelete(
    userId: string,
    adminId?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isActive: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role === ROLE.ADMIN) {
      throw new ConflictException('Cannot delete an admin account');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
        scheduledPermanentDeleteAt: new Date(),
        deactivatedBy: adminId ?? 'ADMIN',
        deactivationReason: 'Account soft-deleted by Administrator',
        refreshToken: null,
        refreshTokenId: null,
        tokenVersion: { increment: 1 },
      },
    });

    // Revoke any active sessions
    await this.prisma.userAuthSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.invalidateActiveAccountCache(userId);

    await this.auditLog.log({
      action: 'ADMIN_SOFT_DELETE_USER',
      entity: 'User',
      entityId: userId,
      adminId,
      ipAddress,
      userAgent,
    });
  }

  async purgeScheduledDeletions(): Promise<number> {
    let deleted = 0;

    /*
     * Process a bounded batch instead of loading every expired account.
     *
     * This prevents a large backlog from causing a huge memory allocation
     * or a very long single cron execution.
     */
    while (true) {
      const due = await this.prisma.user.findMany({
        where: {
          isActive: false,
          scheduledPermanentDeleteAt: {
            lte: new Date(),
          },
        },
        select: {
          id: true,
          email: true,
          role: true,
          orders: {
            select: {
              id: true,
            },
            take: 1,
          },
          carts: {
            select: {
              id: true,
            },
            take: 1,
          },
          payments: {
            select: {
              id: true,
            },
            take: 1,
          },
        },
        orderBy: {
          scheduledPermanentDeleteAt: 'asc',
        },
        take: PURGE_BATCH_SIZE,
      });

      if (due.length === 0) {
        break;
      }

      for (const user of due) {
        try {
          await this.permanentRemove(
            user.id,
            undefined,
            undefined,
            undefined,
            user,
          );

          deleted++;
        } catch (error) {
          /*
           * One problematic account must not prevent the remaining
           * accounts in the batch from being processed.
           */
          this.logger.error(
            `Failed to purge scheduled deletion for user ${user.email} (${user.id})`,
            error instanceof Error ? error.stack : error,
          );
        }
      }

      /*
       * If every record in this batch failed, stop instead of repeatedly
       * selecting the same failing records forever during this cron run.
       */
      if (deleted === 0) {
        break;
      }
    }

    return deleted;
  }

  async assertActiveAccount(userId: string): Promise<void> {
    const cacheKey = `user:active:${userId}`;

    const cached = await this.cache.get<{
      isActive: boolean;
      scheduledPermanentDeleteAt: string | null;
    }>(cacheKey);

    let isActive: boolean;
    let scheduledPermanentDeleteAt: Date | null;

    if (cached) {
      isActive = cached.isActive;

      scheduledPermanentDeleteAt = cached.scheduledPermanentDeleteAt
        ? new Date(cached.scheduledPermanentDeleteAt)
        : null;
    } else {
      const user = await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          isActive: true,
          scheduledPermanentDeleteAt: true,
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      isActive = user.isActive;

      scheduledPermanentDeleteAt = user.scheduledPermanentDeleteAt;

      await this.cache.set(
        cacheKey,
        {
          isActive,
          scheduledPermanentDeleteAt:
            scheduledPermanentDeleteAt?.toISOString() ?? null,
        },
        USER_ACTIVE_CACHE_TTL,
      );
    }

    if (!isActive) {
      if (this.isPastPermanentDeletion(scheduledPermanentDeleteAt)) {
        throw new BadRequestException('Account has been permanently removed');
      }

      throw new BadRequestException(
        'Account is deactivated. Sign in again to reactivate before the scheduled deletion date.',
      );
    }
  }

  async invalidateActiveAccountCache(userId: string): Promise<void> {
    await this.cache.del(`user:active:${userId}`);
  }

  isPastPermanentDeletion(scheduledAt: Date | null): boolean {
    return !!scheduledAt && scheduledAt.getTime() <= Date.now();
  }

  private computeScheduledDeletionDate(): Date {
    const days = this.getDeletionGraceDays();

    const date = new Date();

    date.setDate(date.getDate() + days);

    return date;
  }

  private getDeletionGraceDays(): number {
    const configured = this.config.get<number>('ACCOUNT_DELETION_GRACE_DAYS');

    return configured && configured > 0
      ? configured
      : DEFAULT_ACCOUNT_DELETION_GRACE_DAYS;
  }

  private assertNoRelatedRecords(user: {
    role: ROLE;
    orders: { id: string }[];
    carts: { id: string }[];
    payments: { id: string }[];
  }): void {
    if (
      user.orders.length > 0 ||
      user.carts.length > 0 ||
      user.payments.length > 0
    ) {
      throw new ConflictException(
        'Cannot permanently delete user with existing orders, carts, or payments',
      );
    }
  }

  private assertAccountCanBeModified(
    isActive: boolean,
    scheduledPermanentDeleteAt: Date | null,
  ): void {
    if (isActive) {
      return;
    }

    if (this.isPastPermanentDeletion(scheduledPermanentDeleteAt)) {
      throw new BadRequestException('Account has been permanently removed');
    }

    throw new BadRequestException(
      'Account is deactivated. Sign in again to reactivate before the scheduled deletion date.',
    );
  }

  // ---------------------------------------------------------------------------
  // REFERRAL STATS
  // ---------------------------------------------------------------------------

  async getReferralStats(userId: string): Promise<{
    code: string | null;
    totalReferred: number;
    rewardedCount: number;
    pendingCount: number;
  }> {
    const [referralCode, referred] = await Promise.all([
      this.prisma.referralCode.findUnique({
        where: { userId },
        select: { code: true },
      }),
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        select: { rewardGranted: true },
      }),
    ]);

    const totalReferred = referred.length;
    const rewardedCount = referred.filter((r) => r.rewardGranted).length;
    const pendingCount = totalReferred - rewardedCount;

    return {
      code: referralCode?.code ?? null,
      totalReferred,
      rewardedCount,
      pendingCount,
    };
  }
}
