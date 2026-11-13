import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { createHmac } from 'crypto';
import jwt from 'jsonwebtoken';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/infrastructure/redis/redis.constants';
import { RedlockService } from '../src/infrastructure/redis/redlock.service';
import { OtpService } from '../src/modules/auth/otp/otp.service';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PaymentsService } from '../src/modules/payments/payments.service';

describe('Payment Flow End-to-End (e2e)', () => {
  let app: INestApplication<App>;
  let mockPrisma: any;
  let mockRedis: any;
  let paymentsService: PaymentsService;

  const testUserId = 'u-e2e-customer';
  const testVendorId = 'v-e2e-vendor';
  const testProductId = 'a1111111-1111-4111-8111-111111111111';
  const testVariantId = 'b2222222-2222-4222-8222-222222222222';
  const testOrderId = 'c4b8e21a-4d2b-47e2-8b43-b23023e42101';
  const testPaymentId = 'pay-e2e-1';
  const testTransactionRef = 'TX-REF-E2E-PAYSTACK-100';
  const testPaystackSecret =
    process.env.PAYSTACK_SECRET_KEY ||
    'test-paystack-mock-secret-key-for-e2e-testing';
  const jwtSecret =
    process.env.JWT_SECRET || 'test-jwt-access-secret-minimum-32-chars-long';

  process.env.PAYSTACK_SECRET_KEY = testPaystackSecret;
  process.env.JWT_SECRET = jwtSecret;

  // In-memory simulated database state
  const dbState = {
    user: {
      id: testUserId,
      email: 'customer@nuts-test.com',
      firstName: 'Test',
      lastName: 'Customer',
      role: 'USER',
      isActive: true,
      tokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    vendor: {
      id: testVendorId,
      storeName: 'Nuts Prime Store',
      isApproved: true,
      isActive: true,
    },
    product: {
      id: testProductId,
      vendorId: testVendorId,
      name: 'Premium Roasted Cashews',
      slug: 'premium-roasted-cashews',
      sku: 'CASHEW-MAIN',
      price: new Prisma.Decimal(100), // 100 NGN
      stock: 50,
      lowStockThreshold: 5,
      isActive: true,
      isDeleted: false,
      hasVariants: true,
      images: [{ url: 'https://cdn.example.com/cashew.png' }],
      vendor: {
        id: testVendorId,
        storeName: 'Nuts Prime Store',
        isApproved: true,
        isActive: true,
      },
    },
    variant: {
      id: testVariantId,
      productId: testProductId,
      sku: 'CASHEW-500G',
      price: new Prisma.Decimal(100),
      stock: 50,
      isActive: true,
      isDeleted: false,
      options: { size: '500g' },
    },
    cart: {
      id: 'cart-e2e-1',
      userId: testUserId,
      checkedOut: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    cartItems: [] as any[],
    order: {
      id: testOrderId,
      orderNumber: 'NUTS-ORD-E2E-1',
      userId: testUserId,
      status: OrderStatus.PENDING,
      totalAmount: new Prisma.Decimal(200),
      discountAmount: new Prisma.Decimal(0),
      referralDiscountAmount: new Prisma.Decimal(0),
      finalAmount: new Prisma.Decimal(200),
      shippingFee: new Prisma.Decimal(0),
      shippingAddress: {
        fullName: 'Jane Doe',
        phone: '+2348012345678',
        street: '123 Market St',
        city: 'Ikeja',
        state: 'Lagos',
        country: 'Nigeria',
      },
      stockRestored: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      orderItems: [
        {
          id: 'oi-1',
          orderId: testOrderId,
          productId: testProductId,
          variantId: testVariantId,
          vendorId: testVendorId,
          quantity: 2,
          unitPrice: new Prisma.Decimal(100),
          totalPrice: new Prisma.Decimal(200),
          productSnapshot: {
            name: 'Premium Roasted Cashews',
            sku: 'CASHEW-MAIN',
            images: [{ url: 'https://cdn.example.com/cashew.png' }],
          },
          variantSnapshot: {
            options: [{ name: 'size', value: '500g' }],
          },
          product: {
            name: 'Premium Roasted Cashews',
            slug: 'premium-roasted-cashews',
            sku: 'CASHEW-MAIN',
          },
          variant: {
            id: testVariantId,
            options: [{ name: 'size', value: '500g' }],
          },
        },
      ],
      payment: null as any,
      statusHistory: [] as any[],
    },
    payment: {
      id: testPaymentId,
      orderId: testOrderId,
      userId: testUserId,
      amount: new Prisma.Decimal(200),
      currency: 'NGN',
      status: PaymentStatus.PENDING,
      transactionReference: testTransactionRef,
      paymentMethod: 'paystack',
      paymentLink: 'https://checkout.paystack.com/auth-e2e-123',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    outboxEvents: [] as any[],
    orderStatusHistory: [] as any[],
  };

  beforeAll(async () => {
    mockRedis = {
      status: 'ready',
      on: jest.fn(),
      off: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      lpop: jest.fn().mockResolvedValue([]),
      rpush: jest.fn().mockResolvedValue(1),
      incr: jest.fn().mockResolvedValue(1),
      pexpire: jest.fn().mockResolvedValue(1),
      pttl: jest.fn().mockResolvedValue(60000),
      eval: jest.fn().mockResolvedValue([1, 60000]),
      pipeline: jest.fn(() => ({
        get: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      })),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
    };

    const mockRedlock = {
      acquire: jest.fn().mockResolvedValue({
        release: jest.fn().mockResolvedValue(undefined),
      }),
      using: jest.fn((_resources, _ttl, routine) =>
        routine({ aborted: false }),
      ),
    };

    const mockOtpService = {
      verifyOtp: jest.fn().mockResolvedValue(true),
      consumeVerification: jest.fn().mockResolvedValue(true),
      sendOtp: jest.fn().mockResolvedValue({ success: true }),
    };

    mockPrisma = {
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
      $queryRaw: jest.fn().mockResolvedValue([{ id: dbState.cart.id }]),
      $on: jest.fn(),
      $transaction: jest.fn(async (callback: any) => {
        if (typeof callback === 'function') {
          return callback(mockPrisma);
        }
        return Promise.all(callback);
      }),
      user: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === testUserId || where.email === dbState.user.email) {
            return Promise.resolve(dbState.user);
          }
          return Promise.resolve(null);
        }),
        findFirst: jest.fn().mockResolvedValue(dbState.user),
        create: jest.fn().mockResolvedValue(dbState.user),
        update: jest.fn().mockResolvedValue(dbState.user),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userAuthSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sess-e2e-1',
          userId: testUserId,
          tokenVersion: 0,
          expiresAt: new Date(Date.now() + 86400000),
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: 'sess-e2e-1',
          userId: testUserId,
          tokenVersion: 0,
          expiresAt: new Date(Date.now() + 86400000),
        }),
        create: jest.fn().mockResolvedValue({ id: 'sess-e2e-1' }),
        update: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userWallet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'w-1',
          userId: testUserId,
          balance: new Prisma.Decimal(5000),
        }),
        create: jest.fn(),
      },
      vendorWallet: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'vw-1',
          vendorId: testVendorId,
          balance: new Prisma.Decimal(0),
          pendingBalance: new Prisma.Decimal(0),
        }),
        update: jest.fn().mockResolvedValue({ count: 1 }),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({ id: 'tx-1' }),
      },
      cart: {
        findFirst: jest.fn().mockImplementation(({ where }) => {
          if (where?.userId === testUserId && where?.checkedOut === false) {
            return Promise.resolve({
              ...dbState.cart,
              cartItems: dbState.cartItems.map((ci) => ({
                ...ci,
                product: dbState.product,
                variant: dbState.variant,
              })),
            });
          }
          return Promise.resolve(null);
        }),
        findMany: jest.fn().mockImplementation(() =>
          Promise.resolve([
            {
              ...dbState.cart,
              cartItems: dbState.cartItems.map((ci) => ({
                ...ci,
                product: dbState.product,
                variant: dbState.variant,
              })),
            },
          ]),
        ),
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            ...dbState.cart,
            cartItems: dbState.cartItems.map((ci) => ({
              ...ci,
              product: dbState.product,
              variant: dbState.variant,
            })),
          }),
        ),
        create: jest
          .fn()
          .mockImplementation(() => Promise.resolve(dbState.cart)),
        update: jest.fn().mockImplementation(({ data }) => {
          if (data.checkedOut !== undefined) {
            dbState.cart.checkedOut = data.checkedOut;
          }
          return Promise.resolve(dbState.cart);
        }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      cartItem: {
        findFirst: jest.fn().mockImplementation(({ where }) => {
          const item = dbState.cartItems.find(
            (ci) =>
              (!where?.cartId || ci.cartId === where.cartId) &&
              (!where?.productId || ci.productId === where.productId) &&
              (!where?.variantId || ci.variantId === where.variantId),
          );
          if (!item) return Promise.resolve(null);
          return Promise.resolve({
            ...item,
            product: dbState.product,
            variant: dbState.variant,
          });
        }),
        create: jest.fn().mockImplementation(({ data }) => {
          const newItem = {
            id: 'cart-item-1',
            ...data,
            unitPrice: new Prisma.Decimal(100),
            totalPrice: new Prisma.Decimal(100).mul(data.quantity),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          dbState.cartItems.push(newItem);
          return Promise.resolve({
            ...newItem,
            product: dbState.product,
            variant: dbState.variant,
          });
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const item = dbState.cartItems.find((ci) => ci.id === where?.id);
          if (item) {
            Object.assign(item, data);
            return Promise.resolve({
              ...item,
              product: dbState.product,
              variant: dbState.variant,
            });
          }
          return Promise.resolve(data);
        }),
        deleteMany: jest.fn().mockImplementation(() => {
          dbState.cartItems = [];
          return Promise.resolve({ count: 1 });
        }),
      },
      order: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === testOrderId) {
            return Promise.resolve({
              ...dbState.order,
              orderItems: [
                {
                  id: 'oi-1',
                  orderId: testOrderId,
                  productId: dbState.product.id,
                  variantId: dbState.variant.id,
                  vendorId: testVendorId,
                  quantity: 2,
                  unitPrice: new Prisma.Decimal(100),
                  totalPrice: new Prisma.Decimal(200),
                  productSnapshot: {
                    name: dbState.product.name,
                    sku: dbState.product.sku,
                    images: dbState.product.images,
                  },
                  variantSnapshot: {
                    options: [{ name: 'size', value: '500g' }],
                  },
                  product: {
                    name: dbState.product.name,
                    slug: dbState.product.slug,
                    sku: dbState.product.sku,
                  },
                  variant: {
                    id: dbState.variant.id,
                    options: dbState.variant.options,
                  },
                },
              ],
              payment: dbState.payment,
              statusHistory: dbState.orderStatusHistory,
            });
          }
          return Promise.resolve(null);
        }),
        findFirst: jest
          .fn()
          .mockImplementation(() => Promise.resolve(dbState.order)),
        create: jest.fn().mockResolvedValue(dbState.order),
        update: jest.fn().mockImplementation(({ data }) => {
          Object.assign(dbState.order, data);
          return Promise.resolve(dbState.order);
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }) => {
          if (
            where.id === testOrderId &&
            where.status === OrderStatus.PENDING
          ) {
            dbState.order.status = data.status;
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        }),
      },
      orderItem: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderStatusHistory: {
        create: jest.fn().mockImplementation(({ data }) => {
          dbState.orderStatusHistory.push(data);
          return Promise.resolve({ id: 'hist-1', ...data });
        }),
      },
      payment: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (
            where.transactionReference === testTransactionRef ||
            where.orderId === testOrderId
          ) {
            return Promise.resolve({
              ...dbState.payment,
              order: dbState.order,
              user: dbState.user,
            });
          }
          return Promise.resolve(null);
        }),
        findUniqueOrThrow: jest.fn().mockImplementation(() =>
          Promise.resolve({
            ...dbState.payment,
            order: dbState.order,
            user: dbState.user,
          }),
        ),
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve({
            ...dbState.payment,
            order: dbState.order,
            user: dbState.user,
          }),
        ),
        create: jest.fn().mockResolvedValue(dbState.payment),
        update: jest.fn().mockImplementation(({ data }) => {
          Object.assign(dbState.payment, data);
          return Promise.resolve(dbState.payment);
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }) => {
          if (
            where.id === testPaymentId &&
            where.status === PaymentStatus.PENDING
          ) {
            Object.assign(dbState.payment, data);
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        }),
      },
      outboxEvent: {
        create: jest.fn().mockImplementation(({ data }) => {
          dbState.outboxEvents.push(data);
          return Promise.resolve({ id: 'outbox-1', ...data });
        }),
      },
      checkoutIdempotency: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'idem-1' }),
      },
      shippingAddress: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'addr-1' }),
      },
      stockHistory: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue(dbState.product),
        findFirst: jest.fn().mockResolvedValue(dbState.product),
        update: jest.fn().mockResolvedValue(dbState.product),
      },
      productVariant: {
        findUnique: jest.fn().mockResolvedValue(dbState.variant),
        findFirst: jest.fn().mockResolvedValue(dbState.variant),
        update: jest.fn().mockResolvedValue(dbState.variant),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
      session: {
        create: jest.fn(),
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(REDIS_CLIENT)
      .useValue(mockRedis)
      .overrideProvider(RedlockService)
      .useValue(mockRedlock)
      .overrideProvider(OtpService)
      .useValue(mockOtpService)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
    await app.init();

    paymentsService = moduleFixture.get<PaymentsService>(PaymentsService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  let authAccessToken: string;

  describe('Complete Payment Lifecycle E2E', () => {
    /**
     * PHASE 1: Authenticate and Acquire JWT Access Token
     */
    it('Phase 1: Signs in customer and issues valid Bearer token', () => {
      authAccessToken = jwt.sign(
        {
          sub: testUserId,
          email: dbState.user.email,
          role: 'USER',
          tokenVersion: 0,
        },
        jwtSecret,
        {
          issuer: 'nuts',
          audience: 'nuts-api',
          expiresIn: '15m',
          algorithm: 'HS256',
        },
      );

      expect(authAccessToken).toBeDefined();
    });

    /**
     * PHASE 2: Add Product to Cart & Verify Cart Items
     */
    it('Phase 2: Adds product with variant to cart and verifies active cart state', async () => {
      // 1. Customer adds 2 units of Cashews (500g variant) to cart
      const addRes = await request(app.getHttpServer())
        .post(`/api/v1/cart/items/${testProductId}`)
        .set('Authorization', `Bearer ${authAccessToken}`)
        .send({
          quantity: 2,
          variantId: testVariantId,
        })
        .expect(201);

      expect(addRes.body.success).toBe(true);
      expect(addRes.body.data.addedItem).toBeDefined();
      expect(addRes.body.data.addedItem.quantity).toBe(2);

      // 2. Active cart reflects the newly added item
      const getRes = await request(app.getHttpServer())
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${authAccessToken}`)
        .expect(200);

      expect(getRes.body.success).toBe(true);
      expect(getRes.body.data.cart).toBeDefined();
      expect(getRes.body.data.cart.checkedOut).toBe(false);
      expect(getRes.body.data.cartItems.length).toBe(1);
      expect(getRes.body.data.cartItems[0].quantity).toBe(2);
      expect(getRes.body.data.cartItems[0].productId).toBe(testProductId);
    });

    /**
     * PHASE 3: Checkout Execution & Immediate Cart Emptying
     */
    it('Phase 3: Executes checkout, creates PENDING order, and transactionally empties cart', async () => {
      const idempotencyKey = `idem-${Date.now()}`;

      const res = await request(app.getHttpServer())
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${authAccessToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          shippingAddress: {
            fullName: 'Jane Doe',
            phone: '+2348012345678',
            street: '123 Market St',
            city: 'Ikeja',
            state: 'Lagos',
            country: 'Nigeria',
          },
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(testOrderId);
      expect(res.body.data.status).toBe(OrderStatus.PENDING);
      expect(Number(res.body.data.finalAmount)).toBe(200);

      // Verify cart state transitioned to checkedOut = true and items emptied
      expect(mockPrisma.cart.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cart-e2e-1' },
          data: { checkedOut: true },
        }),
      );
      expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: 'cart-e2e-1' },
      });
    });

    /**
     * PHASE 4: Payment Initialization
     */
    it('Phase 4: Initializes Paystack transaction, receiving authorizationUrl and reference', async () => {
      // Mock Paystack initialize API call
      jest.spyOn<any, any>(paymentsService, 'paystackPost').mockResolvedValue({
        status: true,
        message: 'Authorization url created',
        data: {
          authorization_url: 'https://checkout.paystack.com/auth-e2e-123',
          access_code: 'acc-e2e-123',
          reference: testTransactionRef,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/payment/initialize?orderId=${testOrderId}`)
        .set('Authorization', `Bearer ${authAccessToken}`)
        .send({})
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.authorizationUrl).toBe(
        'https://checkout.paystack.com/auth-e2e-123',
      );
      expect(res.body.data.reference).toBe(testTransactionRef);
      expect(res.body.data.paymentId).toBe(testPaymentId);
    });

    /**
     * PHASE 5: User Lands on Paystack & Bypasses Callback URL -> Webhook Arrives
     *
     * Simulates the exact real-world scenario reported:
     * - Customer completes payment on Paystack.
     * - Customer closes browser or does not wait for callback URL redirection.
     * - Paystack server delivers HMAC-SHA512 signed webhook to /api/v1/payments/webhook.
     * - Request carries NO browser cookies, NO CSRF token.
     * - Paystack verify GET endpoint times out (resilience test).
     */
    it('Phase 5: Paystack webhook confirms settlement asynchronously without CSRF or callback requirement', async () => {
      const webhookPayload = {
        event: 'charge.success',
        data: {
          id: 777999111,
          reference: testTransactionRef,
          status: 'success',
          amount: 20000, // 200 NGN in kobo
          currency: 'NGN',
          paid_at: new Date().toISOString(),
          metadata: {
            order_id: testOrderId,
          },
        },
      };

      const rawBody = JSON.stringify(webhookPayload);
      const signature = createHmac('sha512', testPaystackSecret)
        .update(rawBody)
        .digest('hex');

      // Simulate Paystack verify API timeout/null to prove cryptographically signed webhook fallback works
      jest
        .spyOn<any, any>(paymentsService, 'paystackVerify')
        .mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .post('/api/v1/payments/webhook')
        .set('x-paystack-signature', signature)
        .set('Content-Type', 'application/json')
        .send(rawBody)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ received: true });

      // Verifies payment transitioned to SUCCESS
      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
        where: { id: testPaymentId, status: PaymentStatus.PENDING },
        data: expect.objectContaining({
          status: PaymentStatus.SUCCESS,
          transactionId: '777999111',
          paymentMethod: 'paystack',
        }),
      });

      // Verifies order transitioned from PENDING to PROCESSING
      expect(mockPrisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: testOrderId, status: OrderStatus.PENDING },
        data: { status: OrderStatus.PROCESSING },
      });

      // Verifies order status history note was created
      expect(mockPrisma.orderStatusHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: testOrderId,
          fromStatus: OrderStatus.PENDING,
          toStatus: OrderStatus.PROCESSING,
        }),
      });

      // Verifies vendor wallet credited with 85% merchant earnings
      expect(mockPrisma.vendorWallet.update).toHaveBeenCalled();

      // Verifies transactional outbox event published for downstream notification & email
      expect(mockPrisma.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          aggregateType: 'ORDER',
          aggregateId: testOrderId,
          eventType: 'order.confirmed',
          status: 'PENDING',
        }),
      });
    });

    /**
     * PHASE 6: Storefront Self-Healing & Order Inspection
     *
     * When customer navigates to /order/[id] or callback endpoint:
     * Order reflects PROCESSING and payment reflects SUCCESS.
     */
    it('Phase 6: Order details reflect settled PROCESSING state and empty cart', async () => {
      // 1. Order status query reflects PROCESSING
      const orderRes = await request(app.getHttpServer())
        .get(`/api/v1/orders/${testOrderId}`)
        .set('Authorization', `Bearer ${authAccessToken}`)
        .expect(200);

      expect(orderRes.body.success).toBe(true);
      expect(orderRes.body.data.id).toBe(testOrderId);
      expect(orderRes.body.data.status).toBe(OrderStatus.PROCESSING);

      // 2. Payment verification endpoint returns SUCCESS
      const verifyRes = await request(app.getHttpServer())
        .get(`/api/v1/payments/callback?reference=${testTransactionRef}`)
        .expect(200);

      expect(verifyRes.body.success).toBe(true);
      expect(verifyRes.body.data.status).toBe(PaymentStatus.SUCCESS);
      expect(verifyRes.body.data.transactionReference).toBe(testTransactionRef);

      // 3. Cart query confirms active cart has 0 items
      // When cart was checked out, items were deleted and checkedOut set to true
      mockPrisma.cart.findFirst.mockResolvedValueOnce({
        id: 'cart-e2e-2-new',
        userId: testUserId,
        checkedOut: false,
        cartItems: [],
      });

      const cartRes = await request(app.getHttpServer())
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${authAccessToken}`)
        .expect(200);

      expect(cartRes.body.success).toBe(true);
      expect(cartRes.body.data.cartItems.length).toBe(0);
    });
  });
});
