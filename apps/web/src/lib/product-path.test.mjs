import assert from "node:assert/strict";
import test from "node:test";

import { resolveProductDetailPath } from "./product-path.ts";

test("category product links keep the category hierarchy and append the product", () => {
  assert.equal(
    resolveProductDetailPath("silk-shirt", "/category/fashion/womenswear"),
    "/category/fashion/womenswear/silk-shirt",
  );
});

test("products-page links use the products route", () => {
  assert.equal(resolveProductDetailPath("silk-shirt"), "/product/silk-shirt");
});

test("explicit product links take precedence", () => {
  assert.equal(
    resolveProductDetailPath(
      "silk-shirt",
      "/category/fashion",
      "/campaign/summer/silk-shirt",
    ),
    "/campaign/summer/silk-shirt",
  );
});

test("category links normalize a trailing slash and encode the product slug", () => {
  assert.equal(
    resolveProductDetailPath("shirt blue", "/category/fashion/"),
    "/category/fashion/shirt%20blue",
  );
});
