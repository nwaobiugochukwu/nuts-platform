import assert from "node:assert/strict";
import test from "node:test";

import {
  THEME_COLORS,
  THEME_COLOR_OWN_ATTRIBUTE,
  applyThemeColorMeta,
  themeColorFor,
} from "./theme-color.ts";

/** A minimal fake <head>: enough to prove what the helper does and does NOT touch. */
function fakeDocument(initial = []) {
  const makeMeta = (attrs = {}) => {
    const attributes = new Map(Object.entries(attrs));
    return {
      removed: false,
      mutated: false,
      attributes,
      setAttribute(name, value) {
        attributes.set(name, value);
        this.mutated = true;
      },
      getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
      remove() {
        this.removed = true;
      },
    };
  };
  const children = initial.map((attrs) => makeMeta(attrs));
  return {
    children,
    head: {
      querySelector: (selector) => {
        const attr = selector.match(/\[(.+)\]/)?.[1];
        return children.find((child) => child.attributes.has(attr)) ?? null;
      },
      prepend: (node) => children.unshift(node),
    },
    createElement: () => makeMeta(),
  };
}

test("the browser bar matches the page background of the chosen theme", () => {
  assert.equal(themeColorFor("light"), "#ffffff");
  assert.equal(themeColorFor("dark"), "#09090b");
  assert.notEqual(THEME_COLORS.light, THEME_COLORS.dark);
});

test("creates one tag of its own, first in <head>", () => {
  const doc = fakeDocument([
    { name: "theme-color", content: "#ffffff", media: "(prefers-color-scheme: light)" },
    { name: "theme-color", content: "#09090b", media: "(prefers-color-scheme: dark)" },
  ]);
  applyThemeColorMeta("dark", doc);

  assert.equal(doc.children.length, 3);
  const [own] = doc.children;
  assert.equal(own.getAttribute(THEME_COLOR_OWN_ATTRIBUTE), "");
  assert.equal(own.getAttribute("content"), "#09090b");
  assert.equal(own.getAttribute("media"), null); // no media condition, so it always applies
});

test("never removes or edits the tags React renders (that crashed navigation)", () => {
  const doc = fakeDocument([
    { name: "theme-color", content: "#ffffff", media: "(prefers-color-scheme: light)" },
    { name: "theme-color", content: "#09090b", media: "(prefers-color-scheme: dark)" },
  ]);
  const reactTags = [...doc.children];

  applyThemeColorMeta("dark", doc);
  applyThemeColorMeta("light", doc);
  applyThemeColorMeta("dark", doc);

  for (const tag of reactTags) {
    assert.equal(tag.removed, false);
    assert.equal(tag.mutated, false);
    assert.equal(tag.getAttribute("media") !== null, true);
  }
});

test("repeated and toggled calls reuse the same tag and only change its colour", () => {
  const doc = fakeDocument();
  applyThemeColorMeta("light", doc);
  applyThemeColorMeta("light", doc);
  applyThemeColorMeta("dark", doc);

  assert.equal(doc.children.length, 1);
  assert.equal(doc.children[0].getAttribute("content"), "#09090b");
});
