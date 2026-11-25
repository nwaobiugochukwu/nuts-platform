import {
  Controller,
  Injectable,
  MiddlewareConsumer,
  Module,
  NestModule,
  Param,
  Post,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RequestContextMiddleware } from '@api/common/request-context/request-context.middleware';
import { Audit } from './audit.decorator';
import { auditAlso, auditDetails } from './audit-details';
import { AuditInterceptor } from './audit.interceptor';
import { AuditLogService } from './audit-log.service';

@Injectable()
class ThingService {
  create(id: string) {
    auditDetails({
      entityId: id,
      payload: { name: 'Widget', password: 'must-not-be-stored' },
    });
    return { id };
  }

  login() {
    auditDetails({
      userId: 'user-found',
      payload: { credentialType: 'email' },
    });
    throw new UnauthorizedException('Invalid credentials');
  }

  loginWithUnsuspend() {
    auditAlso({
      action: 'THING_AUTO_UNSUSPEND',
      entity: 'Thing',
      entityId: 'u-9',
    });
    auditDetails({ entityId: 'u-9' });
    return { ok: true };
  }
}

@Controller('things')
class ThingController {
  constructor(private readonly things: ThingService) {}

  @Audit({ action: 'THING_CREATED', entity: 'Thing' })
  @Post('create/:id')
  create(@Param('id') id: string) {
    return this.things.create(id);
  }

  @Audit({
    action: 'THING_LOGIN',
    failureAction: 'THING_LOGIN_FAILED',
    onFailure: true,
    entity: 'Thing',
  })
  @Post('login')
  login() {
    return this.things.login();
  }

  @Audit({ action: 'THING_LOGIN', entity: 'Thing' })
  @Post('login-ok')
  loginOk() {
    return this.things.loginWithUnsuspend();
  }

  @Post('plain')
  plain() {
    return { ok: true };
  }
}

const record = jest.fn();

@Module({
  controllers: [ThingController],
  providers: [
    ThingService,
    { provide: AuditLogService, useValue: { record } },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
class WiringModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((req: { user?: unknown }, _res: unknown, next: () => void) => {
        req.user = { id: 'admin-1', role: 'ADMIN' };
        next();
      }, RequestContextMiddleware)
      .forRoutes('*path');
  }
}

describe('audit wiring through a real Nest app', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WiringModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    url = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => record.mockClear());

  it('records one event: the controller says what happened, the service adds the details', async () => {
    const response = await request(url).post('/things/create/w-1');
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: 'w-1' });
    expect(record).toHaveBeenCalledTimes(1);
    const event = record.mock.calls[0][0];
    expect(event).toMatchObject({
      action: 'THING_CREATED',
      entity: 'Thing',
      entityId: 'w-1',
      adminId: 'admin-1',
      outcome: 'success',
      statusCode: 201,
    });
    expect(event.requestId).toEqual(expect.any(String));
    expect(event.payload).toEqual({ name: 'Widget', password: '[REDACTED]' });
  });

  it('records a failed sign-in under its failure action with the actor the service found', async () => {
    const response = await request(url).post('/things/login');
    expect(response.status).toBe(401);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({
      action: 'THING_LOGIN_FAILED',
      outcome: 'failure',
      statusCode: 401,
      userId: 'user-found',
      payload: { credentialType: 'email' },
    });
  });

  it('records the second event of a request next to the main one', async () => {
    await request(url).post('/things/login-ok');
    expect(record.mock.calls.map(([event]) => event.action)).toEqual([
      'THING_LOGIN',
      'THING_AUTO_UNSUSPEND',
    ]);
  });

  it('records nothing for an endpoint without @Audit', async () => {
    await request(url).post('/things/plain');
    expect(record).not.toHaveBeenCalled();
  });

  it('keeps concurrent requests apart', async () => {
    const ids = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'];
    await Promise.all(
      ids.map((id) => request(url).post(`/things/create/${id}`)),
    );
    const recorded = record.mock.calls.map(([event]) => event.entityId).sort();
    expect(recorded).toEqual([...ids].sort());
    const requestIds = new Set(
      record.mock.calls.map(([event]) => event.requestId),
    );
    expect(requestIds.size).toBe(ids.length);
  });
});
