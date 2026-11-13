export type CategoryStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

// Backward compatibility alias
export type CategoryLevel = 'CATEGORY' | 'PARENT_SUBCATEGORY' | 'SUBCATEGORY';

export interface CategoryBreadcrumbDto {
  id: string;
  name: string;
  slug: string;
  path: string;
  depth: number;
}

export interface CategoryResponseDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  parentId: string | null;
  sortOrder: number;
  status: CategoryStatus;
  isActive: boolean;
  path: string;
  depth: number;
  isLeaf: boolean;
  isRoot: boolean;
  productCount?: number;
  childrenCount?: number;
  breadcrumbs?: CategoryBreadcrumbDto[];
  children?: CategoryResponseDto[];
  subCategories?: CategoryResponseDto[]; // Backward compatibility alias
  level?: CategoryLevel; // Backward compatibility alias
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryRefDto {
  id: string;
  name: string;
  slug: string;
  path?: string;
}