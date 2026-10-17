## What changed

<!-- One or two sentences. Link the issue: Closes #123 -->

## Why

<!-- The problem this solves for traders or contributors. -->

## How to test

<!-- Steps a reviewer can follow. Mention sample-data mode if no keys are needed. -->

1.
2.

## Screenshots

<!-- UI changes: light and dark, desktop and 375 px. Delete if not applicable. -->

| Light | Dark |
|-------|------|
|       |      |

## Checklist

- [ ] `npm run check` passes (typecheck, lint, tests, build)
- [ ] `npm run test:e2e` passes if a page changed
- [ ] New logic in `src/lib/**` has tests; options maths imported from `@/lib/options`, not re-implemented
- [ ] Semantic Tailwind tokens only (no hex colours); checked in light and dark themes
- [ ] Works at 375 px and with the keyboard; loading, empty and error states handled
- [ ] Sample or derived data is visibly labelled; nothing fabricated is shown as live
- [ ] New pages include "Data for education and research. Not investment advice."
- [ ] No secrets, keys or personal data in code, logs or screenshots
