#!/usr/bin/env python3
"""Check local Markdown links and heading fragments without third-party packages."""

from __future__ import annotations

import re
import sys
import os
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
SKIP_DIRS = {".git", "node_modules", ".next", "dist", "build", "coverage"}
LINK_PATTERN = re.compile(r"(?<!!)]\((<[^>]+>|[^)]*)\)")
ANCHOR_PATTERN = re.compile(r"<a\s+(?:id|name)=[\"']([^\"']+)[\"']", re.IGNORECASE)
HEADING_PATTERN = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$", re.MULTILINE)


def markdown_files() -> list[Path]:
    found: list[Path] = []
    for current, directories, files in os.walk(ROOT):
        directories[:] = [directory for directory in directories if directory not in SKIP_DIRS]
        found.extend(Path(current) / name for name in files if name.lower().endswith(".md"))
    return sorted(found)


def heading_anchors(text: str) -> set[str]:
    anchors = set(ANCHOR_PATTERN.findall(text))
    counts: dict[str, int] = {}
    for heading in HEADING_PATTERN.findall(text):
        heading = re.sub(r"[`*_]", "", heading).lower().strip()
        slug = re.sub(r"[^\w\- ]", "", heading, flags=re.UNICODE).replace(" ", "-")
        count = counts.get(slug, 0)
        counts[slug] = count + 1
        anchors.add(slug if count == 0 else f"{slug}-{count}")
    return anchors


def links_in(text: str):
    # Fenced code samples are examples, not navigable links.
    text = re.sub(r"```.*?```|~~~.*?~~~", "", text, flags=re.DOTALL)
    for match in LINK_PATTERN.finditer(text):
        raw = match.group(1).strip()
        if raw.startswith("<") and raw.endswith(">"):
            yield raw[1:-1]
        else:
            yield raw.split(None, 1)[0]


def main() -> int:
    files = markdown_files()
    anchors = {path: heading_anchors(path.read_text(encoding="utf-8")) for path in files}
    errors: list[str] = []

    for source in files:
        content = source.read_text(encoding="utf-8")
        for target in links_in(content):
            parsed = urlsplit(target)
            if parsed.scheme or target.startswith("//"):
                continue

            relative = unquote(parsed.path)
            destination = (source.parent / relative).resolve() if relative else source.resolve()
            if not destination.exists():
                errors.append(f"{source.relative_to(ROOT)}: missing local target {target}")
                continue

            if not parsed.fragment:
                continue
            if destination.is_dir():
                destination = next(
                    (destination / name for name in ("README.md", "index.md") if (destination / name).exists()),
                    destination,
                )
            if destination.suffix.lower() != ".md":
                continue
            fragment = unquote(parsed.fragment)
            if destination in anchors and fragment not in anchors[destination]:
                errors.append(
                    f"{source.relative_to(ROOT)}: missing fragment #{fragment} in {destination.relative_to(ROOT)}"
                )

    if errors:
        print("Documentation link check failed:")
        print("\n".join(f"- {error}" for error in errors))
        return 1

    print(f"Checked local Markdown links and fragments in {len(files)} files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
