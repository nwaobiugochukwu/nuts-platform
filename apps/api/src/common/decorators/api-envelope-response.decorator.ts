import { applyDecorators, type Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiResponse,
  getSchemaPath,
  type ApiResponseOptions,
} from '@nestjs/swagger';
import { ApiResponseDto } from '../dto/api-response.dto';

export interface ApiEnvelopeResponseOptions {
  status?: ApiResponseOptions['status'];
  description?: string;
  isArray?: boolean;
}

export function ApiEnvelopeResponse<TModel>(
  model: Type<TModel>,
  options: ApiEnvelopeResponseOptions = {},
): MethodDecorator & ClassDecorator {
  const dataSchema = options.isArray
    ? { type: 'array' as const, items: { $ref: getSchemaPath(model) } }
    : { $ref: getSchemaPath(model) };

  return applyDecorators(
    ApiExtraModels(ApiResponseDto, model),
    ApiResponse({
      status: options.status ?? 200,
      description: options.description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiResponseDto) },
          {
            type: 'object',
            properties: { data: dataSchema },
            required: ['data'],
          },
        ],
      },
    }),
  );
}
