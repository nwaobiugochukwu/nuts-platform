import { Injectable } from '@nestjs/common';
import { ADMIN_INDEXES } from '../constants/search.constants';
import type { SearchIndex, SearchResponsePayload } from '../types/search.types';
import { filterIndexes } from '../utils/search-input.util';
import { AdminIndexSearchService } from './admin-index-search.service';
import { SearchRunnerService } from './search-runner.service';

/** The administrators' search across everything: products, stores, categories, users, orders and discount codes. */
@Injectable()
export class AdminSearchService {
  constructor(
    private readonly runner: SearchRunnerService,
    private readonly indexes: AdminIndexSearchService,
  ) {}

  async searchAdminGlobal(
    search: string,
    types?: SearchIndex[],
    page = 1,
    limit = 20,
  ): Promise<SearchResponsePayload | null> {
    return this.runner.run({
      namespace: 'global',
      indexes: filterIndexes(types, ADMIN_INDEXES),
      search,
      page,
      limit,
      searchIndex: (index, term, perIndex) =>
        this.indexes.search(index, term, perIndex),
    });
  }
}
