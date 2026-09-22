# MediaListory UI and interaction refresh

The existing blue Movies, green Shows, pink Anime and amber Games identities,
display fonts, dark/light themes and catalog integrations are preserved.

## Shared design

`Frontend/experience.css` is the final shared style layer after `styles.css`.
It defines quieter surfaces, rounded controls, consistent spacing and focus
indicators, poster elevation, button feedback and short content transitions.
Reduced-motion preferences disable the added motion, including page transitions.
Hover movement is restricted to devices with hover support.

`Frontend/experience.js` adds direct desktop Library/Collections links and a
five-destination mobile navigation bar. Active state follows the library tab;
safe-area padding keeps content and notifications above the mobile bar.

## Personal spaces

- Library holds tracked titles and progress. Collections are curated lists,
  with a direct `library.html?tab=lists` destination that preserves category filters.
- Collection cards use the existing API's cover images, category tints, descriptions,
  title counts and public/private indicators. Native disclosure buttons expose
  expanded state and work with Enter/Space. Existing search, sorting, editing,
  deletion and title management remain available.
- Profiles lead with the user's display name, bio and chosen category accent.
  Import/export and destructive account tools live in labelled disclosures.
  The public-profile link can also preview the current user's profile.
- Follower/following counts open searchable, keyboard-accessible dialogs using
  existing social endpoints, with retry, empty states and real profile links.
- Follow actions provide pending feedback, prevent duplicate requests, show the
  confirmed relationship immediately and report connection failures. Private
  follow requests keep their distinct Requested state.

## Verification

Run `npm test` for unit and smoke coverage, including navigation state,
collection disclosures, connection lists and follow feedback.

For isolated browser checks, serve `Frontend` on localhost and run:

```powershell
$env:BASE_URL = 'http://localhost:3100'
npm run test:ui
```

The browser suite intercepts API traffic with local fixtures; it never changes
real accounts. It covers 320, 390, 768 and 1440px layouts, both themes, browse
filters, quick-add, search, library views, collections, profiles, social states,
dialog focus restoration and reduced motion. Live catalog and account read-only
views should also be reviewed after deployment.
