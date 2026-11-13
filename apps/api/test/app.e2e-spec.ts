import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/infrastructure/redis/redis.constants';
import { RedlockService } from '../src/infrastructure/redis/redlock.service';
import { OtpService } from '../src/modules/auth/otp/otp.service';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';

describe('Nuts API (e2e)', () => {
  let app: INestApplication<App>;
  let mockPrisma: any;
  let mockRedis: any;

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
      $queryRaw: jest.fn().mockResolvedValue([{ '1': 1 }]),
      $on: jest.fn(),
      $transaction: jest.fn(async (callback: any) => {
        if (typeof callback === 'function') {
          return callback(mockPrisma);
        }
        return Promise.all(callback);
      }),
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userAuthSession: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'sess-1' }),
        update: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userWallet: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      referralCode: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      category: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cat-1',
            name: 'Electronics',
            slug: 'electronics',
            description: null,
            imageUrl: null,
            parentId: null,
            sortOrder: 0,
            status: 'ACTIVE',
            isActive: true,
            path: 'electronics',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
      session: {
        create: jest.fn(),
      },
      product: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
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

    app = moduleFixture.createNestApplication();
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
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('health', () => {
    /*
     * [API / Health / Performance]
     * Liveness check should respond immediately with status ok.
     */
    it('GET /api/v1/health returns ok', () => {
      return request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200)
        .expect((res) => {
          const body = res.body as {
            success: boolean;
            data: { status: string };
          };
          expect(body.success).toBe(true);
          expect(body.data.status).toBe('ok');
        });
    });
  });

  describe('auth', () => {
    const email = `e2e-${Date.now()}@example.com`;
    const password = 'TestPassword123!';

    /*
     * [API / Authentication / Registration Flow]
     * Verifies user creation endpoint returns 201 with auth tokens.
     */
    it('POST /api/v1/auth/register creates a user and issues session token', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u-e2e-1',
        email,
        firstName: 'E2E',
        lastName: 'User',
        isActive: true,
        role: 'USER',
        tokenVersion: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.referralCode.findUnique.mockResolvedValue(null);
      mockPrisma.referralCode.create.mockResolvedValue({
        id: 'ref-1',
        code: 'REF123',
      });

      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email,
          password,
          otpCode: '123456',
          firstName: 'E2E',
          lastName: 'User',
        })
        .expect(201)
        .expect((res) => {
          const body = res.body as {
            success: boolean;
            data: { user: { email: string }; accessToken: string };
          };
          expect(body.success).toBe(true);
          expect(body.data.user.email).toBe(email);
          expect(body.data.accessToken).toBeDefined();
        });
    });

    /*
     * [API / Authentication / Login Flow]
     * Verifies credentials verification, password hashing check, and session return.
     */
    it('POST /api/v1/auth/login returns session for valid credentials', async () => {
      const hashedPassword = await bcrypt.hash(password, 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u-e2e-1',
        email,
        password: hashedPassword,
        isActive: true,
        role: 'USER',
        tokenVersion: 0,
      });

      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200)
        .expect((res) => {
          const body = res.body as {
            success: boolean;
            data: { accessToken: string };
          };
          expect(body.success).toBe(true);
          expect(body.data.accessToken).toBeDefined();
        });
    });
  });

  describe('categories', () => {
    /*
     * [API / Catalog / Performance-sensitive Querying]
     * Verifies category hierarchy tree retrieval with subcategories.
     */
    it('GET /api/v1/categories lists public category tree', () => {
      return request(app.getHttpServer())
        .get('/api/v1/categories')
        .expect(200)
        .expect((res) => {
          const body = res.body as { success: boolean; data: unknown };
          expect(body.success).toBe(true);
          expect(Array.isArray(body.data)).toBe(true);
        });
    });
  });
});
