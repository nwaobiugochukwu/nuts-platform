import assert from "node:assert/strict";
import test from "node:test";

import { THEME_COLORS, themeColorFor } from "./theme-color.ts";

test("the browser bar matches the page background of the chosen theme", () => {
  assert.equal(themeColorFor("light"), "#ffffff");
  assert.equal(themeColorFor("dark"), "#09090b");
  assert.notEqual(THEME_COLORS.light, THEME_COLORS.dark);
});
