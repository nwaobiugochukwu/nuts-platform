import { removeDuplicateAdminCategoryPaths } from './swagger-paths.util';

describe('removeDuplicateAdminCategoryPaths', () => {
  it('removes singular documentation aliases when the plural route exists', () => {
    const paths: Record<string, unknown> = {
      '/api/v1/admin/category': {},
      '/api/v1/admin/categories': {},
      '/api/v1/admin/category/:id': {},
      '/api/v1/admin/categories/:id': {},
      '/api/v1/admin/categories/:id/products': {},
    };

    removeDuplicateAdminCategoryPaths(paths);

    expect(Object.keys(paths)).toEqual([
      '/api/v1/admin/categories',
      '/api/v1/admin/categories/:id',
      '/api/v1/admin/categories/:id/products',
    ]);
  });

  it('keeps a singular route when no plural documentation route exists', () => {
    const paths: Record<string, unknown> = {
      '/api/v1/admin/category/:id/products': {},
    };

    removeDuplicateAdminCategoryPaths(paths);

    expect(Object.keys(paths)).toEqual(['/api/v1/admin/category/:id/products']);
  });
});
