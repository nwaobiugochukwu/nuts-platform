import assert from "node:assert/strict";
import test from "node:test";

import { groupProductsByImmediateCategory } from "./category-product-groups.ts";

const leaf = {
  id: "shirts",
  slug: "shirts",
  name: "Shirts",
  parentId: "mens",
  children: [],
};

const mens = {
  id: "mens",
  slug: "mens",
  name: "Menswear",
  parentId: "fashion",
  children: [leaf],
};

const fashion = {
  id: "fashion",
  slug: "fashion",
  name: "Fashion",
  parentId: null,
  children: [mens],
};

const product = {
  id: "shirt-product",
  name: "Linen shirt",
  slug: "linen-shirt",
  categoryId: "shirts",
  category: null,
  subcategory: { id: "shirts", slug: "shirts", name: "Shirts" },
  parentSubcategory: null,
};

test("groups descendant products under the immediate child at the current level", () => {
  const groups = groupProductsByImmediateCategory({
    products: [product],
    children: [mens],
    categoryTree: [fashion],
    fallbackCategory: fashion,
  });

  assert.deepEqual(groups.map(({ name, products }) => [name, products.length]), [
    ["Menswear", 1],
  ]);
});

test("groups products under a root category when browsing the category index", () => {
  const groups = groupProductsByImmediateCategory({
    products: [product],
    children: [fashion],
    categoryTree: [fashion],
  });

  assert.deepEqual(groups.map(({ name, products }) => [name, products.length]), [
    ["Fashion", 1],
  ]);
});

test("keeps empty sections only when they have another level to browse", () => {
  const emptyRoot = {
    ...fashion,
    id: "empty-root",
    slug: "empty-root",
    name: "Empty root",
    children: [{ ...mens, id: "empty-child", parentId: "empty-root" }],
  };

  const groups = groupProductsByImmediateCategory({
    products: [],
    children: [emptyRoot],
    categoryTree: [emptyRoot],
  });

  assert.deepEqual(groups.map(({ name }) => name), ["Empty root"]);
});
