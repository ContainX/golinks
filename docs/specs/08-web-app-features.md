# 08. Web App Features

This spec lists what the web application must let members and admins do. It deliberately does not describe screens, flows, layout, or interaction details. UX design is a separate step to be worked out together before any UI is built. Items marked "candidate" are behaviors worth considering during that step, not commitments.

## 1. Technical baseline

- Single-page application built with React and Material UI, served by the API at `/` and `/_/**`.
- Data access exclusively through the HTTP API (spec 05) using the shared schemas.
- Organization branding (spec 06): title, logo, favicon, primary and secondary colors, and a set of colors per color scheme. The theme derives from these at runtime.
- Responsive: usable on a phone, designed for a laptop.
- Accessible: keyboard-navigable, labeled controls, sufficient contrast.
- Light and dark color schemes derived from the organization's brand colors. The scheme follows the system preference unless the member fixes it; the choice is stored in `preferences.colorScheme` (`system`, `light`, or `dark`).

Every color is settled in layers, the first layer that names one winning: the organization's color for the scheme being built (`branding.light`, `branding.dark`), then its scheme-independent `primaryColor` or `secondaryColor` — which the dark scheme lightens until it reads against the surface actually in use — then the deployment's own default for that scheme, then the app's. Page ground and surface exist per scheme only; a scheme that names neither keeps the app's.

A deployment states its own defaults in `apps/web/src/branding/`. `types.ts` describes what may be set — four colors per scheme, the two font families, the corner radius — and belongs to the application. `overrides.ts` holds the values and `fonts.ts` loads the typefaces; both belong to the deployment, ship empty of any deployment's choices, and are never changed by the application, so that a fork carries its own identity across upgrades without merging anything. `overrides.ts` must stay free of side effects: the build reads it to write the ground colors into `index.html`, so that the frame painted before the bundle evaluates is already the deployment's own.

## 2. Sign-in

- Provider chooser when more than one provider is configured, or when an error must be shown (spec 02 §2.1). With one provider and no error, the browser never sees this page.
- Signed-out confirmation.

## 3. Directory

Members must be able to:

- see the organization's links, sorted by popularity by default, with the option to sort by keyword, created, or updated;
- search by keyword, destination, or owner as they type;
- filter to their own links, to a namespace, and to programmatic links;
- copy a link's full short form (`go/handbook`) and open its destination;
- see who owns a link, when it was last used, and how often;
- distinguish programmatic and unlisted links at a glance, with an explanation of what unlisted means;
- page through large directories without loading everything;
- press Enter on a search that exactly matches a keyword to go there (a full navigation, so the resolver records the visit).

## 4. Creating links

- Create with namespace (when the organization has more than one), keyword, destination, and unlisted flag.
- Admins may create on behalf of another member.
- Keyword input enforces the organization's allowed pattern as the member types.
- When a keyword already exists or conflicts, show the existing link and offer to open or edit it rather than only an error.
- Arriving from a resolver miss (`/_/?keyword=...&namespace=...`) pre-fills the form and shows similar existing links from the suggestions endpoint, so the member can pick one instead of creating a duplicate.

Placeholders are explained inline when a member types `%s`, with a live preview of the expanded destination for a sample value.

## 5. Editing and deleting

- Edit destination in place for links the member may edit; edit keyword, namespace, and unlisted flag for links the member owns or administers.
- Actions the member is not permitted to take are visibly disabled with an explanation.
- Delete requires deliberate confirmation.

Deleting a link with more than 100 visits requires typing its keyword to confirm.

## 6. Ownership transfer

- Owners and admins can generate a transfer link and copy it.
- A member who opens a transfer link sees what they are accepting (keyword, destination, current owner) and accepts or declines; expired or invalid tokens explain why.
- Admins can reassign an owner directly.

## 7. Account and navigation

- Show the signed-in member's email and role; sign out.
- Organization navigation links from settings, with admin-only entries shown only to admins.
- Organization banner when set.
- Setup instructions for the OpenSearch keyword.

## 8. Admin

- Users: list, search, view link counts, enable or disable, change role. Self-modification blocked.
- Settings: edit everything in spec 06 §2 with validation feedback, including namespace conflict lists and the effects of toggling punctuation sensitivity or resolution mode. Settings the deployment fixes for every organization (spec 06 §6) are shown but cannot be edited, and the ones with no input on the screen are named so that an admin knows what is not theirs to change.
- Events: browse the audit trail with filters.

## 9. Flows

Page structure, the drawer at `/_/links/:id`, the unknown-keyword screen at `/_/?keyword=`, Enter-to-go, the admin tabs, first-run onboarding, and mobile behavior are specified in ADR 0002.
