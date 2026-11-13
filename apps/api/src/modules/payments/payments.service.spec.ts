import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { EmailService } from '@api/infrastructure/mail/email.service';
import { OutboxService } from '@api/infrastructure/outbox/outbox.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { UsersService } from '@api/modules/users/users.service';
import { WalletService } from '@api/modules/wallet/wallet.service';
import { CircuitBreakerService } from '@api/infrastructure/resiliency/circuit-breaker.service';
import { PaymentsService } from './payments.service';

const mockCircuitBreakerService = {
  executePaystack: jest.fn((fn: () => unknown) => fn()),
  executeEmail: jest.fn((fn: () => unknown) => fn()),
  executeCloudinary: jest.fn((fn: () => unknown) => fn()),
  getStatus: jest.fn(),
};

const mockOutboxService = {
  appendEvent: jest.fn(),
};

const mockPrisma: any = {
  payment: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  paymentRefund: {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  order: {
    updateMany: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  orderStatusHistory: {
    create: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) =>
    callback(mockPrisma),
  ),
};

const mockUsersService = {
  assertActiveAccount: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'PAYSTACK_SECRET_KEY') return 'sk_test_abc123';
    return undefined;
  }),
  getOrThrow: jest.fn((key: string) => {
    if (key === 'PAYSTACK_SECRET_KEY') return 'sk_test_abc123';
    throw new Error(`Missing env: ${key}`);
  }),
};

const mockEmailService = {
  sendPaymentReceipt: jest.fn(),
  sendOrderConfirmation: jest.fn(),
};

const mockWalletService = {
  creditVendorPending: jest.fn(),
  debitVendorPending: jest.fn(),
  settleVendorEarning: jest.fn(),
};

const mockReferralService = {
  grantReferralRewards: jest.fn(),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

describe('PaymentsService â€“ refund', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: UsersService, useValue: mockUsersService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: WalletService, useValue: mockWalletService },
        { provide: OutboxService, useValue: mockOutboxService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: CircuitBreakerService, useValue: mockCircuitBreakerService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  const makePayment = (overrides = {}) => ({
    id: 'pay_1',
    orderId: 'order_1',
    amount: 5000,
    currency: 'ngn',
    status: PaymentStatus.SUCCESS,
    transactionId: 'txn_abc',
    transactionReference: 'ref_abc',
    paymentMethod: 'paystack',
    paymentLink: null,
    order: {
      id: 'order_1',
      status: OrderStatus.PROCESSING,
    },
    ...overrides,
  });

  describe('refund', () => {
    it('should throw NotFoundException when payment does not exist', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(null);

      await expect(service.refund('pay_missing', 'admin_1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when payment is not COMPLETED', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(
        makePayment({ status: PaymentStatus.PENDING }),
      );

      await expect(service.refund('pay_1', 'admin_1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for invalid refund amount (exceeds payment)', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(makePayment());

      await expect(service.refund('pay_1', 'admin_1', 10000)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for zero or negative refund amount', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(makePayment());

      await expect(service.refund('pay_1', 'admin_1', 0)).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.refund('pay_1', 'admin_1', -100)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
