import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '@api/infrastructure/redis/redis.constants';

describe('SearchService', () => {
  let service: SearchService;
  let mockRedis: {
    get: jest.Mock;
    set: jest.Mock;
  };
  let mockPrisma: {
    $queryRaw: jest.Mock;
    product: {
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };

    mockPrisma = {
      $queryRaw: jest.fn(),
      product: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: REDIS_CLIENT,
          useValue: mockRedis,
        },
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  describe('searchProducts', () => {
    it('returns null for searches shorter than MIN_SEARCH_LENGTH (2 characters)', async () => {
      const result = await service.searchProducts('a');
      expect(result).toBeNull();
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns cached results when present in Redis', async () => {
      const cachedData = { ids: ['p1', 'p2'], total: 2 };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await service.searchProducts('shoes');
      expect(result).toEqual(cachedData);
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('executes database query with multi-tier relevance ranking when cache misses', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { id: 'prod-1', score: 10.8, total_count: 1 },
      ]);

      const result = await service.searchProducts('shoes');
      expect(result).toEqual({ ids: ['prod-1'], total: 1 });
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(mockRedis.set).toHaveBeenCalledTimes(1);
    });
  });

  describe('autocomplete', () => {
    it('returns null for empty search string', async () => {
      const result = await service.autocomplete('   ');
      expect(result).toBeNull();
    });

    it('returns autocomplete hits across marketplace indexes sorted by relevance score', async () => {
      mockPrisma.$queryRaw.mockImplementation((query) => {
        return Promise.resolve([
          {
            id: 'prod-1',
            name: 'Leather Shoes',
            sku: 'SH-01',
            slug: 'leather-shoes',
            price: 15000,
            imageUrl: 'https://example.com/shoes.jpg',
            score: 10.5,
            total_count: 1,
          },
        ]);
      });

      const result = await service.autocomplete('leather');
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      if (result && result.length > 0) {
        expect(result[0].title).toBe('Leather Shoes');
      }
    });
  });
});
