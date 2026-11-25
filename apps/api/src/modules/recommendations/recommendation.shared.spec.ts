import {
  applyDismissalPenalty,
  scoreAndDiversify,
  withExploration,
  type CandidateProduct,
  type ScoredProduct,
} from './recommendation.shared';

function product(
  id: string,
  vendorId: string,
  categoryId = 'c1',
  ageDays = 1,
): CandidateProduct {
  return {
    id,
    name: `Product ${id}`,
    description: null,
    categoryId,
    vendorId,
    createdAt: new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000),
    category: { name: categoryId },
  };
}

function scored(items: CandidateProduct[]): ScoredProduct[] {
  return items.map((item, index) => ({
    id: item.id,
    score: 100 - index,
    product: item,
  }));
}

describe('applyDismissalPenalty', () => {
  it('lowers a category weight and drops it when it reaches zero', () => {
    const weights = new Map([
      ['shoes', 5],
      ['bags', 1.5],
    ]);
    applyDismissalPenalty(weights, ['shoes', 'bags', 'unknown']);
    expect(weights.get('shoes')).toBe(3);
    expect(weights.has('bags')).toBe(false);
    expect(weights.has('unknown')).toBe(false);
  });

  it('stacks for repeated dismissals in the same category', () => {
    const weights = new Map([['shoes', 5]]);
    applyDismissalPenalty(weights, ['shoes', 'shoes']);
    expect(weights.get('shoes')).toBe(1);
    applyDismissalPenalty(weights, ['shoes']);
    expect(weights.has('shoes')).toBe(false);
  });
});

describe('withExploration', () => {
  const familiar = [
    product('a1', 'v1'),
    product('a2', 'v1'),
    product('a3', 'v2'),
    product('a4', 'v2'),
    product('a5', 'v1'),
    product('a6', 'v2'),
  ];
  const strangers = [
    product('n1', 'v9'),
    product('n2', 'v8'),
    product('n3', 'v9'),
  ];
  const all = scored([...familiar, ...strangers]);
  const selected = all.slice(0, 6);
  const weights = new Map([
    ['v1', 5],
    ['v2', 3],
  ]);

  it('places candidates from unfamiliar stores mid-shelf, one per store', () => {
    const result = withExploration(selected, all, weights, 2, 6);
    expect(result).toHaveLength(6);
    const ids = result.map(({ id }) => id);
    expect(ids).toContain('n1');
    expect(ids).toContain('n2');
    expect(ids).not.toContain('n3'); // same store as n1
    expect(ids.indexOf('n1')).toBe(3);
  });

  it('never exceeds the limit and keeps the best picks first', () => {
    const result = withExploration(selected, all, weights, 2, 6);
    expect(result.slice(0, 3).map(({ id }) => id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('returns the shelf untouched when every store is already familiar', () => {
    const familiarOnly = scored(familiar);
    const result = withExploration(
      familiarOnly.slice(0, 4),
      familiarOnly,
      weights,
      2,
      6,
    );
    expect(result).toEqual(familiarOnly.slice(0, 4));
  });

  it('does nothing when no slots are requested or the shelf is tiny', () => {
    expect(withExploration(selected, all, weights, 0, 6)).toBe(selected);
    expect(
      withExploration(selected.slice(0, 3), all, weights, 2, 6),
    ).toHaveLength(3);
  });
});

describe('scoreAndDiversify exploration', () => {
  const candidates = [
    product('a1', 'v1', 'c1'),
    product('a2', 'v1', 'c1'),
    product('a3', 'v2', 'c1'),
    product('a4', 'v2', 'c2'),
    product('a5', 'v3', 'c2'),
    product('n1', 'v9', 'c3', 5),
  ];
  const categoryWeights = new Map([
    ['c1', 6],
    ['c2', 3],
  ]);
  const vendorWeights = new Map([
    ['v1', 4],
    ['v2', 3],
    ['v3', 2],
  ]);

  it('is off by default', () => {
    const ids = scoreAndDiversify(
      candidates,
      new Set(),
      categoryWeights,
      vendorWeights,
      new Map(),
      new Map(),
      5,
    );
    expect(ids).not.toContain('n1');
  });

  it('adds an unfamiliar store when exploration slots are given', () => {
    const ids = scoreAndDiversify(
      candidates,
      new Set(),
      categoryWeights,
      vendorWeights,
      new Map(),
      new Map(),
      5,
      new Set(),
      1,
    );
    expect(ids).toContain('n1');
    expect(ids).toHaveLength(5);
  });

  it('never returns excluded (dismissed) products', () => {
    const ids = scoreAndDiversify(
      candidates,
      new Set(['a1', 'n1']),
      categoryWeights,
      vendorWeights,
      new Map(),
      new Map(),
      5,
      new Set(),
      1,
    );
    expect(ids).not.toContain('a1');
    expect(ids).not.toContain('n1');
  });
});
