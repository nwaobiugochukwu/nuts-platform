import { MAX_LIMIT, MIN_SEARCH_LENGTH } from '../constants/search.constants';
import type {
  SearchIndex,
  SearchResponsePayload,
  SearchResultItem,
} from '../types/search.types';
import {
  buildCacheKey,
  normalizeLimit,
  normalizePage,
  normalizeSearch,
} from '../utils/search-input.util';
import { Injectable } from '@nestjs/common';
import { SearchCacheService } from './search-cache.service';

/** What searching one index returns: the hits and how many there are in all. */
export interface IndexHits {
  items: SearchResultItem[];
  total: number;
}

/** Searches one index for a term, returning at most `limit` hits. */
export type IndexSearch = (
  index: SearchIndex,
  term: string,
  limit: number,
) => Promise<IndexHits>;

export interface SearchRun {
  /** The start of the cache key, so different audiences never share an entry (e.g. `global`, `vendor:<id>`). */
  namespace: string;
  indexes: SearchIndex[];
  search: string;
  page: number;
  limit: number;
  searchIndex: IndexSearch;
}

/**
 * The engine every kind of search shares: take a term, ask each index for its best hits, merge them
 * by relevance, cut out the requested page and cache the answer. What differs between storefront,
 * admin and vendor search is only which indexes are asked and how each one is searched, which the
 * caller supplies.
 */
@Injectable()
export class SearchRunnerService {
  constructor(private readonly cache: SearchCacheService) {}

  /** A page of merged results, or null when the term is too short to search. */
  async run(run: SearchRun): Promise<SearchResponsePayload | null> {
    const search = normalizeSearch(run.search);
    if (search.length < MIN_SEARCH_LENGTH) return null;

    const page = normalizePage(run.page);
    const limit = normalizeLimit(run.limit);
    const indexes = [...run.indexes].sort();
    const cacheKey = buildCacheKey(
      run.namespace,
      search,
      indexes.join(','),
      page,
      limit,
    );

    const cached = await this.cache.get<SearchResponsePayload>(cacheKey);
    if (cached) return cached;

    // Fetch enough from each index to fill the requested page; bounded so a request cannot cause
    // an unbounded query.
    const perIndex = Math.min(page * limit, MAX_LIMIT);
    const results = await Promise.all(
      indexes.map((index) => run.searchIndex(index, search, perIndex)),
    );

    // Sorting every hit by relevance (rather than concatenating index by index) stops the first
    // index dominating the page.
    const all = results
      .flatMap((entry) => entry.items)
      .sort((a, b) => b.score - a.score);
    const total = results.reduce((sum, entry) => sum + entry.total, 0);
    const start = (page - 1) * limit;

    const response: SearchResponsePayload = {
      results: all.slice(start, start + limit),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
    await this.cache.set(cacheKey, response);
    return response;
  }

  /**
   * The first page of hits only, cached under its own key, for as-you-type suggestions.
   * `cacheNamespace` names this kind of autocomplete; `runNamespace` is the namespace of the search
   * it is built on.
   */
  async autocomplete(options: {
    cacheNamespace: string;
    runNamespace: string;
    indexes: SearchIndex[];
    search: string;
    limit: number;
    searchIndex: IndexSearch;
  }): Promise<SearchResultItem[] | null> {
    const search = normalizeSearch(options.search);
    if (!search) return null;

    const limit = normalizeLimit(options.limit);
    const cacheKey = buildCacheKey(
      options.cacheNamespace,
      search,
      options.indexes.join(','),
      limit,
    );
    const cached = await this.cache.get<SearchResultItem[]>(cacheKey);
    if (cached) return cached;

    const result = await this.run({
      namespace: options.runNamespace,
      indexes: options.indexes,
      search,
      page: 1,
      limit,
      searchIndex: options.searchIndex,
    });
    if (!result) return null;

    await this.cache.set(cacheKey, result.results);
    return result.results;
  }
}
