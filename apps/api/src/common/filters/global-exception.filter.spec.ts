import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { GlobalExceptionFilter } from './global-exception.filter';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockArgumentsHost: any;

  beforeEach(() => {
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockRequest = {
      method: 'POST',
      path: '/api/v1/checkout',
      ip: '127.0.0.1',
      headers: {},
      user: { id: 'u-1', role: 'USER' },
    };

    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };

    filter = new GlobalExceptionFilter({
      get: jest.fn(),
    } as unknown as ConfigService);
  });

  it('formats standard HttpException correctly', () => {
    const exception = new BadRequestException('Validation failed');

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Validation failed',
        error: { code: 'VALIDATION_ERROR' },
      }),
    );
  });

  it('formats array of validation errors from class-validator', () => {
    const exception = new BadRequestException([
      'Email is invalid',
      'Password too short',
    ]);

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Email is invalid',
        error: {
          code: 'VALIDATION_ERROR',
          details: ['Email is invalid', 'Password too short'],
        },
      }),
    );
  });

  it('maps Prisma P2002 unique constraint violation to 409 Conflict', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '7.8.0', meta: { target: ['email'] } },
    );

    filter.catch(prismaError, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: { code: 'DATABASE_ERROR' },
      }),
    );
  });

  it('maps Prisma P2025 record not found to 404 Not Found', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'An operation failed because it depends on one or more records that were required but not found.',
      { code: 'P2025', clientVersion: '7.8.0' },
    );

    filter.catch(prismaError, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: { code: 'DATABASE_ERROR' },
      }),
    );
  });

  it('masks unhandled errors as 500 without leaking stack traces', () => {
    const unexpectedError = new Error(
      'Database password was exposed in raw query string',
    );

    filter.catch(unexpectedError, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Internal server error',
        error: { code: 'INTERNAL_ERROR' },
      }),
    );
  });

  it('passes through domain error code and meta for 4xx responses', () => {
    const exception = new ConflictException({
      code: 'INSUFFICIENT_STOCK',
      message: 'Some items are unavailable',
      meta: { items: [{ productId: 'p-1', requested: 2, available: 1 }] },
    });

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Some items are unavailable',
        error: {
          code: 'INSUFFICIENT_STOCK',
          meta: { items: [{ productId: 'p-1', requested: 2, available: 1 }] },
        },
      }),
    );
  });

  it('ignores malformed domain codes and never exposes meta on 5xx', () => {
    const exception = new InternalServerErrorException({
      code: 'not a code',
      message: 'boom',
      meta: { secret: 'x' },
    });

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { code: 'SERVER_ERROR' },
      }),
    );
  });
});
