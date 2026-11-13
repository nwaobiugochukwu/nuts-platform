import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CategoryStatus } from '@prisma/client';

export class CategoryBreadcrumbDto {
  @ApiProperty({ description: 'Category ID' })
  id!: string;

  @ApiProperty({ description: 'Category Name' })
  name!: string;

  @ApiProperty({ description: 'Category Slug' })
  slug!: string;

  @ApiProperty({ description: 'Full Materialized Path' })
  path!: string;

  @ApiProperty({ description: 'Depth in tree (0 = root)' })
  depth!: number;
}

export class CategoryResponseDto {
  @ApiProperty({
    description: 'Unique identifier of the category',
    example: 'c1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({
    description: 'Display name of the category',
    example: 'Electronics',
  })
  name!: string;

  @ApiProperty({
    description: 'URL-friendly slug derived from the category name',
    example: 'electronics',
  })
  slug!: string;

  @ApiPropertyOptional({
    description: 'Detailed description of the category',
    example: 'Consumer electronics and accessories.',
  })
  description!: string | null;

  @ApiPropertyOptional({
    description: 'URL of the category image or icon',
    example: 'https://example.com/images/electronics.jpg',
  })
  imageUrl!: string | null;

  @ApiPropertyOptional({
    description:
      'Unique identifier of the parent category (null for root category)',
    example: null,
  })
  parentId!: string | null;

  @ApiProperty({
    description: 'Display sort order among siblings',
    example: 0,
  })
  sortOrder!: number;

  @ApiProperty({
    description: 'Lifecycle status of the category',
    enum: CategoryStatus,
    example: CategoryStatus.ACTIVE,
  })
  status!: CategoryStatus;

  @ApiProperty({
    description: 'Whether the category is currently active (status === ACTIVE)',
    example: true,
  })
  isActive!: boolean;

  @ApiProperty({
    description:
      'Materialized path of the category (e.g. electronics/phones/android-phones)',
    example: 'electronics',
  })
  path!: string;

  @ApiProperty({
    description: 'Depth level in the hierarchy (0 = root category)',
    example: 0,
  })
  depth!: number;

  @ApiProperty({
    description: 'Whether this category has no children',
    example: false,
  })
  isLeaf!: boolean;

  @ApiProperty({
    description: 'Whether this category has no parent (root node)',
    example: true,
  })
  isRoot!: boolean;

  @ApiPropertyOptional({
    description: 'Number of active products directly assigned to this category',
    example: 24,
  })
  productCount?: number;

  @ApiPropertyOptional({
    description: 'Total number of child categories directly under this node',
    example: 3,
  })
  childrenCount?: number;

  @ApiPropertyOptional({
    description: 'Full breadcrumb trail from root down to this category',
    type: () => [CategoryBreadcrumbDto],
  })
  breadcrumbs?: CategoryBreadcrumbDto[];

  @ApiPropertyOptional({
    description: 'List of child categories (recursive)',
    type: () => [CategoryResponseDto],
  })
  children?: CategoryResponseDto[];

  @ApiPropertyOptional({
    description: 'Backward-compatible alias for children',
    type: () => [CategoryResponseDto],
  })
  subCategories?: CategoryResponseDto[];

  @ApiPropertyOptional({
    description: 'Backward-compatible taxonomy classification level',
    example: 'CATEGORY',
  })
  level?: string;

  @ApiProperty({
    description: 'Timestamp when the category was created',
    example: '2026-06-13T14:30:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Timestamp when the category was last updated',
    example: '2026-06-13T15:00:00.000Z',
  })
  updatedAt!: Date;
}
