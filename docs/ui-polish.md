# UI polish verification

This pass retains the static HTML/vanilla JavaScript frontend, category colors,
typography, routes, APIs, backend, and existing page structure.

## Reference work

- Inspected [Trakt](https://app.trakt.tv/) at desktop and mobile sizes for poster
  hierarchy, compact metadata, and access to tracking actions.
- Used the 21st MCP to search filter toolbars and empty states, and retrieved
  [Filter Token Bar by laziekiki](https://21st.dev/@laziekiki/components/filter-token-bar).
  Adapted its removable filter summaries, clear labels, and focus-return pattern
  to native selects in `Frontend/browse-ui.js`. No React, animation package, or
  component framework was added.
- Kept the existing poster grids, native dropdowns, score slider, detail pages,
  and carousels; polished their shared styles and interaction details.

## Changes

- Mobile category navigation and global search remain visible without opening
  the menu. Keyboard navigation in the account menu is supported.
- Filters have persistent field labels and removable applied-filter tokens.
  Search restrictions are explained visibly on touch screens.
- Browse requests preserve the latest query during slow responses. Error-state
  retry retains the current query, filters, sort, and page.
- Media cards link to detail routes, support opening in another tab, use 2:3
  frames, and label community ratings as /5. Game artwork fits without cropping.
- Mobile quick-add uses a bounded sheet with a backdrop, larger controls,
  keyboard containment, and focus restoration. Personal scores retain /10.
- Library category/status controls wrap without horizontal scrolling; mobile
  statistics can be expanded. Long profile text wraps safely.
- Long synopses collapse on mobile; desktop tracking controls use two columns.
  Collection dialogs share the existing accessible modal lifecycle.
- Removed background glow and backdrop blur; tightened spacing, radii, button
  contrast, focus visibility, loading frames, and empty/error recovery.

## Verification

`npm test` passes the 107 existing unit/smoke tests. JavaScript syntax checks
and `git diff --check` also pass.

`test/e2e/ui-polish.cjs` verifies all four browse pages, all four detail types,
dashboard, library/list/grid views, profiles and profile editing, people,
authentication, informational pages, and dialogs at 320, 390, 768, and 1440px.
It also checks filter removal, delayed queries, score keyboard controls, search
focus handling, loading/empty/error recovery, and light mode.

Run against a local `npm start` server with the `playwright` package available
to Node (installed locally or supplied via `NODE_PATH`) and Google Chrome:

```sh
node test/e2e/ui-polish.cjs
```

Set `UI_SCREENSHOTS` to an output directory for screenshots. The harness
intercepts every API request and uses local fixtures; it does not authenticate
against a real account or persist library changes. Live guest browsing was
also visually checked with the existing providers. These are browser viewport
checks, not physical iOS/Android device tests. Nothing was deployed.
