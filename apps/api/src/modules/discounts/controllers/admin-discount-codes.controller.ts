import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { DiscountCodeManagementService } from '../services/discount-code-management.service';
import {
  CreateAdminDiscountCodeDto,
  DiscountCodeResponseDto,
  ListDiscountCodesQueryDto,
  UpdateAdminDiscountCodeDto,
} from '@api/modules/discounts/dto';
import { Message } from '@api/common/decorators/message.decorator';
import { Roles } from '@api/common/decorators/role.decorator';
import { ApiResponseDto } from '@api/common/dto/api-response.dto';

@ApiTags('ADMIN - DISCOUNT CODES')
@Controller('admin/discounts')
@Roles(ROLE.ADMIN)
@ApiBearerAuth('JWT-auth')
export class AdminDiscountCodesController {
  constructor(private readonly discountCodes: DiscountCodeManagementService) {}

  @Post()
  @Message('Discount code created successfully')
  @ApiOperation({
    summary: 'Create a discount code (admin)',
    description:
      'Creates a platform-wide discount code that applies to every product regardless of vendor or category.',
  })
  @ApiBody({ type: CreateAdminDiscountCodeDto })
  @ApiResponse({ status: 201, type: ApiResponseDto<DiscountCodeResponseDto> })
  @ApiBadRequestResponse({ description: 'Bad request - validation error' })
  async create(
    @Body() dto: CreateAdminDiscountCodeDto,
  ): Promise<DiscountCodeResponseDto> {
    return this.discountCodes.createForAdmin(dto);
  }

  @Get()
  @Message('Discount codes retrieved successfully')
  @ApiOperation({
    summary: 'List all discount codes (admin)',
    description: 'Retrieve a list of all discount codes with usage counts.',
  })
  @ApiResponse({ status: 200, type: ApiResponseDto<DiscountCodeResponseDto[]> })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized â€” no valid JWT session.',
  })
  async findAll(
    @Query() query: ListDiscountCodesQueryDto,
  ): Promise<DiscountCodeResponseDto[]> {
    return this.discountCodes.findAllForAdmin(query.limit, query.offset);
  }

  @Patch(':id')
  @Message('Discount code updated successfully')
  @ApiOperation({ summary: 'Update a platform discount code' })
  @ApiParam({ name: 'id', description: 'Discount code ID' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminDiscountCodeDto,
  ): Promise<DiscountCodeResponseDto> {
    return this.discountCodes.updateForAdmin(id, dto);
  }

  @Patch(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @Message('Discount code deactivated successfully')
  @ApiOperation({
    summary: 'Deactivate a discount code',
    description: 'Set a discount code as inactive so it can no longer be used.',
  })
  @ApiParam({ name: 'id', description: 'Discount code ID' })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<null>,
    description: 'Discount code deactivated',
  })
  @ApiNotFoundResponse({ description: 'Discount code not found' })
  async deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<null> {
    await this.discountCodes.deactivate(id, undefined, true);
    return null;
  }

  @Patch(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @Message('Discount code reactivated successfully')
  @ApiOperation({
    summary: 'Reactivate a discount code',
    description: 'Set a deactivated discount code back to active status.',
  })
  @ApiParam({ name: 'id', description: 'Discount code ID' })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<null>,
    description: 'Discount code reactivated',
  })
  @ApiNotFoundResponse({ description: 'Discount code not found' })
  async reactivate(@Param('id', ParseUUIDPipe) id: string): Promise<null> {
    await this.discountCodes.reactivate(id, undefined, true);
    return null;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Message('Discount code deleted successfully')
  @ApiOperation({
    summary: 'Delete a discount code',
    description:
      'Permanently delete a discount code. Cannot delete if it has been used.',
  })
  @ApiParam({ name: 'id', description: 'Discount code ID' })
  @ApiResponse({
    status: 200,
    type: ApiResponseDto<null>,
    description: 'Discount code deleted',
  })
  @ApiBadRequestResponse({ description: 'Cannot delete used discount code' })
  @ApiNotFoundResponse({ description: 'Discount code not found' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<null> {
    await this.discountCodes.remove(id, undefined, true);
    return null;
  }
}
