import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface PrismaErrorResponse {
  status: HttpStatus;
  message: string;
}

export function getPrismaErrorDetail(
  error: Prisma.PrismaClientKnownRequestError,
): PrismaErrorResponse {
  switch (error.code) {
    case 'P2002': {
      const target = error.meta?.target;
      const targetStr = Array.isArray(target)
        ? target.join(', ')
        : typeof target === 'string'
          ? target
          : 'field';
      return {
        status: HttpStatus.CONFLICT,
        message: `A record with this ${targetStr} already exists`,
      };
    }
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        message: 'Record not found',
      };
    case 'P2003': {
      const fieldName =
        typeof error.meta?.field_name === 'string'
          ? error.meta.field_name
          : null;
      const message = fieldName
        ? `Invalid reference for field "${fieldName}"`
        : 'Invalid relation reference or related record not found';
      return {
        status: HttpStatus.BAD_REQUEST,
        message,
      };
    }
    case 'P2021':
    case 'P2022':
      // Missing tables/columns are deployment or schema drift errors, not
      // invalid client input. Keep the response generic and report a 500.
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Database request failed',
      };
    default:
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Database request failed',
      };
  }
}

export function mapPrismaError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const { status, message } = getPrismaErrorDetail(error);
    switch (status) {
      case HttpStatus.CONFLICT:
        throw new ConflictException(message);
      case HttpStatus.NOT_FOUND:
        throw new NotFoundException(message);
      case HttpStatus.BAD_REQUEST:
        throw new BadRequestException(message);
    }
  }
  throw error;
}
