import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiEnvelopeResponse } from '@api/common/decorators/api-envelope-response.decorator';
import { Message } from '@api/common/decorators/message.decorator';
import { Public } from '@api/common/decorators/public.decorator';
import { CategoriesService } from '../categories.service';
import {
  CategoryBreadcrumbDto,
  CategoryResponseDto,
} from '../dto/category-response.dto';

@ApiTags('CATEGORIES')
@Public()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({
    summary: 'Get public categories',
    description:
      'Retrieve the active category hierarchy with nested children and navigation metadata.',
  })
  @ApiEnvelopeResponse(CategoryResponseDto, { isArray: true })
  async getCategories(): Promise<CategoryResponseDto[]> {
    return this.categoriesService.getTree(false, false);
  }

  @Get('tree')
  @ApiOperation({
    summary: 'Get public categories (alias)',
    description: 'Backward-compatible alias for GET /categories.',
  })
  @ApiEnvelopeResponse(CategoryResponseDto, { isArray: true })
  async getTree(): Promise<CategoryResponseDto[]> {
    return this.categoriesService.getTree(false, false);
  }

  @Get('roots')
  @Message('Root categories retrieved successfully')
  @ApiOperation({
    summary: 'Get top-level root categories',
    description:
      'Retrieve top-level department/root categories for navigation.',
  })
  @ApiEnvelopeResponse(CategoryResponseDto, { isArray: true })
  async getRoots(): Promise<CategoryResponseDto[]> {
    return this.categoriesService.getRootCategories(false);
  }

  @Get('search')
  @Message('Category search completed')
  @ApiOperation({
    summary: 'Search categories across hierarchy',
    description:
      'Search for categories by name, slug, or path, returning results with breadcrumbs.',
  })
  @ApiQuery({ name: 'q', required: true, description: 'Search keyword' })
  @ApiEnvelopeResponse(CategoryResponseDto, { isArray: true })
  async search(@Query('q') query: string): Promise<CategoryResponseDto[]> {
    return this.categoriesService.searchCategories(query, false);
  }

  @Get('path/*path')
  @Message('Category retrieved successfully')
  @ApiOperation({
    summary:
      'Find a category by URL path (e.g. electronics/phones/android-phones)',
    description:
      'Resolve a slug path to a category node with breadcrumbs and children.',
  })
  @ApiParam({
    name: 'path',
    description: 'Full slug path to resolve',
  })
  @ApiNotFoundResponse({ description: 'Path not found' })
  @ApiBadRequestResponse({ description: 'Invalid path parameter' })
  @ApiEnvelopeResponse(CategoryResponseDto)
  async findByPath(
    @Param() params: Record<string, string | string[] | undefined>,
    @Req() req: Request,
  ): Promise<CategoryResponseDto> {
    let pathString = '';
    const url = req.originalUrl || req.url || '';
    const markerIndex = url.indexOf('/categories/path/');
    if (markerIndex !== -1) {
      pathString = url
        .slice(markerIndex + '/categories/path/'.length)
        .split('?')[0];
    } else {
      const raw = params['0'] || params['path'];
      if (Array.isArray(raw)) {
        const filtered = raw.filter(
          (s) =>
            s !== 'categories' && s !== 'path' && s !== 'api' && s !== 'v1',
        );
        pathString = filtered.join('/');
      } else if (typeof raw === 'string') {
        pathString = raw;
      }
    }

    const cleanPath = decodeURIComponent(pathString || '').replace(
      /^\/+|\/+$/g,
      '',
    );
    const slugs = cleanPath.split(/[/,]+/).filter(Boolean);
    return this.categoriesService.findByPath(slugs, false);
  }

  @Get(':idOrSlug/breadcrumbs')
  @Message('Category breadcrumbs retrieved successfully')
  @ApiOperation({
    summary: 'Get breadcrumb trail for category',
    description:
      'Returns the ordered chain of ancestors from root down to this category.',
  })
  @ApiParam({ name: 'idOrSlug', description: 'Category UUID or slug' })
  @ApiEnvelopeResponse(CategoryBreadcrumbDto, { isArray: true })
  async getBreadcrumbs(
    @Param('idOrSlug') idOrSlug: string,
  ): Promise<CategoryBreadcrumbDto[]> {
    const category = await this.categoriesService
      .findBySlug(idOrSlug, false)
      .catch(() => this.categoriesService.findOne(idOrSlug));
    return this.categoriesService.getBreadcrumbs(category.id);
  }

  @Get(':idOrSlug/children')
  @Message('Child categories retrieved successfully')
  @ApiOperation({
    summary: 'Get direct children of category',
    description:
      'Returns all direct child categories under the specified category node.',
  })
  @ApiParam({ name: 'idOrSlug', description: 'Category UUID or slug' })
  @ApiEnvelopeResponse(CategoryResponseDto, { isArray: true })
  async getChildren(
    @Param('idOrSlug') idOrSlug: string,
  ): Promise<CategoryResponseDto[]> {
    const category = await this.categoriesService
      .findBySlug(idOrSlug, false)
      .catch(() => this.categoriesService.findOne(idOrSlug));
    return this.categoriesService.getChildren(category.id, false);
  }

  @Get(':slug')
  @Message('Category retrieved successfully')
  @ApiOperation({
    summary: 'Get category by slug or ID',
    description: 'Returns full category details, child nodes, and breadcrumbs.',
  })
  @ApiParam({ name: 'slug', description: 'Category slug or UUID' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  @ApiEnvelopeResponse(CategoryResponseDto)
  async findOne(@Param('slug') slug: string): Promise<CategoryResponseDto> {
    return this.categoriesService
      .findBySlug(slug, false)
      .catch(() => this.categoriesService.findOne(slug));
  }
}
