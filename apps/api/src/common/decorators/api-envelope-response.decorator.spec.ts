import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CategoryResponseDto } from '@api/modules/categories/dto/category-response.dto';
import { ApiEnvelopeResponse } from './api-envelope-response.decorator';

@Controller('swagger-contract')
class SwaggerContractController {
  @Get('categories')
  @ApiEnvelopeResponse(CategoryResponseDto, { isArray: true })
  listCategories(): CategoryResponseDto[] {
    return [];
  }
}

describe('ApiEnvelopeResponse', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SwaggerContractController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('documents the concrete array payload inside the standard response envelope', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Contract test').setVersion('1').build(),
    );
    const response =
      document.paths['/swagger-contract/categories']?.get?.responses?.['200'];
    const schema =
      response && 'content' in response
        ? response.content?.['application/json']?.schema
        : undefined;

    expect(schema).toEqual({
      allOf: [
        { $ref: '#/components/schemas/ApiResponseDto' },
        {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/CategoryResponseDto' },
            },
          },
          required: ['data'],
        },
      ],
    });
    expect(document.components?.schemas?.CategoryResponseDto).toBeDefined();
  });
});
