# Changelog

<!-- Documentation: https://www.html-code-generator.com/javascript/virtual-scrolling -->

All notable changes to hcg-virtual-scroll are documented in this file.
This project follows [Semantic Versioning](https://semver.org/) - MAJOR.MINOR.PATCH.

## 1.0.2

- Slimmed the library stylesheet to the core virtual-scroll classes only (demo styles moved into the demo page)
- Added default centering styles for the empty and loading states (`.hcg-vs-empty`, `.hcg-vs-loading`)
- Added this CHANGELOG

## 1.0.1

Documentation and packaging improvements - no library API changes.

- Added a Live Demo link to the README
- Replaced the demo videos with GIFs so they render on the npm page too
- Added a "Using with React, Vue & Svelte" guide
- Fixed the Table of Contents anchor links
- Added minified builds: `hcg-virtual-scroll.min.js` and `hcg-virtual-scroll.min.css`

## 1.0.0

Initial release.

- Fixed and dynamic (per-item) row heights
- DOM recycling via `keyField`
- Infinite scroll with `onReachEnd` / `onLoadMore`
- Chat / reverse mode with `onReachStart` and `prepend()`
- Loading and empty states (`showLoading`, `hideLoading`, `emptyText`, `emptyHTML`)
- Adaptive overscan during fast scrolling
- ResizeObserver-driven re-render
- ARIA `list` / `listitem` roles
- Works with `div`, `ul`, `ol`, and `table` containers
- Browser global, CommonJS, and ES module compatible
- Zero dependencies
