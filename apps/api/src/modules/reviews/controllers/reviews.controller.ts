import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { GetUser } from '@api/common/decorators/get-user.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { Public } from '@api/common/decorators/public.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';
import {
  CreateReviewDto,
  ProductReviewsResponseDto,
  ReviewResponseDto,
} from '../dto/create-review.dto';
import { ReviewsService } from '../reviews.service';

@ApiTags('REVIEWS')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Roles(ROLE.USER)
  @Post()
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Create a review for a purchased product',
    description:
      'Creates a review for a product the user has purchased. One review per product per user.',
  })
  @ApiBody({ type: CreateReviewDto })
  @ApiCreatedResponse({
    description: 'Review created successfully',
    type: ApiResponseDto<ReviewResponseDto>,
  })
  @ApiNotFoundResponse({ description: 'Product not found or not purchased' })
  @ApiConflictResponse({
    description: 'Review already exists for this product',
  })
  @ApiBadRequestResponse({ description: 'Validation error' })
  @Message('Review submitted successfully')
  create(
    @GetUser('id') userId: string,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    return this.reviewsService.create(userId, dto);
  }

  @Get('product/:productId')
  @Public()
  @ApiOperation({
    summary: 'Get review summary and items for a product',
    description:
      'Returns active reviews, aggregate rating, and distribution breakdown for a product.',
  })
  @ApiParam({ name: 'productId', description: 'Product ID' })
  @ApiOkResponse({
    description: 'Product reviews summary and list',
    type: ApiResponseDto<ProductReviewsResponseDto>,
  })
  @ApiNotFoundResponse({ description: 'Product not found' })
  findByProduct(
    @Param('productId') productId: string,
  ): Promise<ProductReviewsResponseDto> {
    return this.reviewsService.findByProduct(productId);
  }

  @Roles(ROLE.USER)
  @Delete(':id')
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete your own review',
    description:
      'Deletes a review belonging to the authenticated user. Users can only delete their own reviews.',
  })
  @ApiParam({ name: 'id', description: 'Review ID' })
  @ApiOkResponse({
    type: ApiResponseDto<null>,
    description: 'Review deleted successfully',
  })
  @ApiNotFoundResponse({ description: 'Review not found' })
  @ApiBadRequestResponse({ description: 'Validation error' })
  @Message('Review deleted successfully')
  async remove(
    @GetUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<null> {
    await this.reviewsService.remove(userId, id);
    return null;
  }
}

@ApiTags('REVIEWS')
@Public()
@Controller('products/:productId/reviews')
export class ProductReviewsCanonicalController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get review summary and items for a product (Canonical)',
    description:
      'Returns active reviews, aggregate rating, and distribution breakdown for a product.',
  })
  @ApiParam({ name: 'productId', description: 'Product ID' })
  @ApiOkResponse({
    description: 'Product reviews summary and list',
    type: ApiResponseDto<ProductReviewsResponseDto>,
  })
  @ApiNotFoundResponse({ description: 'Product not found' })
  findByProduct(
    @Param('productId') productId: string,
  ): Promise<ProductReviewsResponseDto> {
    return this.reviewsService.findByProduct(productId);
  }
}
