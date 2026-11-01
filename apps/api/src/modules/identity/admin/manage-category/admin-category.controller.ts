import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ROLE } from '@prisma/client';
import { CategoriesService } from '@api/modules/catalog/categories/categories.service';
import { CategoryResponseDto } from '@api/modules/catalog/categories/dto/category-response.dto';
import { CreateCategoryDto } from '@api/modules/catalog/categories/dto/create-category.dto';
import { MoveCategoryDto } from '@api/modules/catalog/categories/dto/move-category.dto';
import { ReorderCategoriesDto } from '@api/modules/catalog/categories/dto/reorder-categories.dto';
import { UpdateCategoryDto } from '@api/modules/catalog/categories/dto/update-category.dto';
import { GetUser } from '@api/modules/shared/decorators/get-user.decorator';
import { Message } from '@api/modules/shared/decorators/message.decorator';
import { Roles } from '@api/modules/shared/decorators/role.decorator';
import { ApiEnvelopeResponse } from '@api/modules/shared/decorators/api-envelope-response.decorator';

@ApiTags('ADMIN - CATEGORY')
@ApiBearerAuth('JWT-auth')
@Controller('admin/categories')
@Roles(ROLE.ADMIN)
export class AdminCategoryController {
  constructor(private readonly categoriesService: CategoriesService) {}

  // ─── READ ────────────────────────────────────────────────────────────────────

  @Get()
  @Message('Categories retrieved successfully')
  @ApiOperation({
    summary: 'Get all categories including inactive and archived (admin)',
    description: 'Returns the complete category hierarchy for administration.',
  })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  @ApiEnvelopeResponse(CategoryResponseDto, {
    isArray: true,
    description: 'Categories returned successfully.',
  })
  async getAdminCategories(
    @Query('includeArchived') includeArchived?: string,
  ): Promise<CategoryResponseDto[]> {
    const showArchived = includeArchived === 'true';
    return this.categoriesService.getTree(true, showArchived);
  }

  @Get(':idOrSlug')
  @Message('Category retrieved successfully')
  @ApiOperation({
    summary: 'Get single category details with breadcrumbs (admin)',
    description:
      'Fetches category details by UUID or slug, including inactive and archived.',
  })
  @ApiParam({
    name: 'idOrSlug',
    description: 'URL slug or UUID of the category to retrieve.',
  })
  @ApiEnvelopeResponse(CategoryResponseDto, {
    description: 'Category found and returned.',
  })
  @ApiNotFoundResponse({ description: 'Category not found.' })
  async findOne(
    @Param('idOrSlug') idOrSlug: string,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService
      .findBySlug(idOrSlug, true)
      .catch(() => this.categoriesService.findOne(idOrSlug));
  }

  // ─── WRITE / MUTATE ──────────────────────────────────────────────────────────

  @Post()
  @Message('Category created successfully')
  @ApiOperation({
    summary: 'Create a new category node',
    description:
      'Creates a root category or a child under an existing active parent category.',
  })
  @ApiBody({ type: CreateCategoryDto })
  @ApiEnvelopeResponse(CategoryResponseDto, {
    status: 201,
    description: 'Category created successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Validation error — invalid input data.',
  })
  @ApiConflictResponse({ description: 'Conflict — duplicate name or slug.' })
  async create(
    @Body() dto: CreateCategoryDto,
    @GetUser('id') adminId: string,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.create(dto, adminId);
  }

  @Patch(':idOrSlug')
  @Message('Category updated successfully')
  @ApiOperation({
    summary: 'Update category metadata, status, or position',
    description:
      'Updates category details such as name, slug, description, image, or parentId.',
  })
  @ApiParam({
    name: 'idOrSlug',
    description: 'UUID or slug of the category to update.',
  })
  @ApiBody({ type: UpdateCategoryDto })
  @ApiEnvelopeResponse(CategoryResponseDto, {
    status: 200,
    description: 'Category updated successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Validation error — invalid input data.',
  })
  @ApiNotFoundResponse({ description: 'Category not found.' })
  @ApiConflictResponse({
    description: 'Conflict — slug or name already taken.',
  })
  async update(
    @Param('idOrSlug') idOrSlug: string,
    @Body() dto: UpdateCategoryDto,
    @GetUser('id') adminId: string,
  ): Promise<CategoryResponseDto> {
    const category = await this.categoriesService
      .findBySlug(idOrSlug, true)
      .catch(() => this.categoriesService.findOne(idOrSlug));
    return this.categoriesService.update(category.id, dto, adminId);
  }

  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  @Message('Category moved successfully')
  @ApiOperation({
    summary: 'Move category in hierarchy',
    description:
      'Moves a category to a new parent or to root, preventing cyclic relationships.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the category to move' })
  @ApiBody({ type: MoveCategoryDto })
  @ApiEnvelopeResponse(CategoryResponseDto, {
    status: 200,
    description: 'Category moved and hierarchy paths updated.',
  })
  async move(
    @Param('id') id: string,
    @Body() dto: MoveCategoryDto,
    @GetUser('id') adminId: string,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.moveCategory(id, dto, adminId);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  @Message('Categories reordered successfully')
  @ApiOperation({
    summary: 'Reorder sibling categories',
    description:
      'Sets the sort order of sibling categories under a parent or root.',
  })
  @ApiQuery({
    name: 'parentId',
    required: false,
    description: 'Parent category UUID (null for root)',
  })
  @ApiBody({ type: ReorderCategoriesDto })
  @ApiEnvelopeResponse(CategoryResponseDto, {
    status: 200,
    isArray: true,
    description: 'Categories reordered.',
  })
  async reorder(
    @Query('parentId') parentId: string | undefined,
    @Body() dto: ReorderCategoriesDto,
    @GetUser('id') adminId: string,
  ): Promise<CategoryResponseDto[]> {
    return this.categoriesService.reorderChildren(
      parentId || null,
      dto.categoryIds,
      adminId,
    );
  }

  @Patch(':idOrSlug/activate')
  @HttpCode(HttpStatus.OK)
  @Message('Category activated successfully')
  @ApiOperation({
    summary: 'Activate a category and descendants',
    description:
      'Activates a category and cascades to all its descendant categories.',
  })
  @ApiParam({ name: 'idOrSlug', description: 'Category UUID or slug' })
  async activate(
    @Param('idOrSlug') idOrSlug: string,
    @GetUser('id') adminId: string,
  ): Promise<null> {
    await this.categoriesService.setActive(idOrSlug, true, adminId);
    return null;
  }

  @Patch(':idOrSlug/deactivate')
  @HttpCode(HttpStatus.OK)
  @Message('Category deactivated successfully')
  @ApiOperation({
    summary: 'Deactivate a category and descendants',
    description:
      'Deactivates a category and cascades to all its descendant categories.',
  })
  @ApiParam({ name: 'idOrSlug', description: 'Category UUID or slug' })
  async deactivate(
    @Param('idOrSlug') idOrSlug: string,
    @GetUser('id') adminId: string,
  ): Promise<null> {
    await this.categoriesService.setActive(idOrSlug, false, adminId);
    return null;
  }

  @Patch(':idOrSlug/archive')
  @HttpCode(HttpStatus.OK)
  @Message('Category archived successfully')
  @ApiOperation({
    summary: 'Archive a category (safe deprecation)',
    description:
      'Archives a category and cascades to descendants. Existing product associations are preserved but new assignments are blocked.',
  })
  @ApiParam({ name: 'idOrSlug', description: 'Category UUID or slug' })
  async archive(
    @Param('idOrSlug') idOrSlug: string,
    @GetUser('id') adminId: string,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.archiveCategory(idOrSlug, adminId);
  }

  @Patch(':idOrSlug/restore')
  @HttpCode(HttpStatus.OK)
  @Message('Category restored successfully')
  @ApiOperation({
    summary: 'Restore an archived category',
    description: 'Restores an archived category to ACTIVE status.',
  })
  @ApiParam({ name: 'idOrSlug', description: 'Category UUID or slug' })
  async restore(
    @Param('idOrSlug') idOrSlug: string,
    @GetUser('id') adminId: string,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.restoreCategory(idOrSlug, adminId);
  }

  @Delete(':idOrSlug')
  @HttpCode(HttpStatus.OK)
  @Message('Category permanently deleted')
  @ApiOperation({
    summary: 'Permanently delete a category (leaf only, no products)',
    description:
      'Irreversibly deletes an empty leaf category that has zero child categories and zero products.',
  })
  @ApiParam({ name: 'idOrSlug', description: 'Category UUID or slug' })
  async remove(
    @Param('idOrSlug') idOrSlug: string,
    @GetUser('id') adminId: string,
  ): Promise<{ message: string }> {
    return this.categoriesService.remove(idOrSlug, adminId);
  }
}
