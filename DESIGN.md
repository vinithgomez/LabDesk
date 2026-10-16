# LabDesk design spec

Authoritative visual and UX spec. Read it fully before touching any UI. `CLAUDE.md` still rules behaviour, API, data and tests; this file rules how the app looks and feels. If the two ever disagree on behaviour, `CLAUDE.md` wins.

## 1. Who it is for and what it must do well

- **People:** students (book, check in), faculty and lab in-charges (approve, watch usage), admins (configure, analyse). Used on laptops in a department office and on phones at the lab door.
- **Primary job:** find a free slot on a resource and book it in a few seconds. Secondary jobs: check in by QR, approve or reject, read utilization.
- **Feel:** a precise, calm instrument panel for a lab. Quiet surfaces, one confident colour, clear status. It must not look like a generic SaaS template.

## 2. Principles

1. **One memorable thing: the week calendar.** It is drawn like a lab instrument timeline (ruler ticks, graph-paper hairlines, hatched busy time). Everything else stays quiet and disciplined so the calendar carries the identity.
2. **Hierarchy through type, spacing and tone, not boxes.** Do not chop every screen into identical rounded cards. Use open sections, dividers, tables and one panel level. A card is only for something that is genuinely a separate object.
3. **Status is never colour alone.** Every status has colour, an icon and a text label. Busy and maintenance time also use a hatch pattern.
4. **One primary action per view.** Everything else is secondary or a quiet text action.
5. **Plain words.** Sentence case. Verbs for actions ("Book slot", "Approve", "Cancel booking"). The same action keeps the same name across button, confirm dialog and toast. Errors say what happened and what to do (keep `lib/api-errors.ts` as the only source of error sentences). Empty states say what to do next.
6. **Same quality on laptop and phone.** Design both on purpose. The phone layout is not the desktop layout squeezed.

## 3. Tokens

Define as CSS variables on `:root` (light) and `:root[data-theme="dark"]` (dark), mapped into the Tailwind config. Components never use raw hex.

### Colour, light (default)

| Token | Value | Use |
|---|---|---|
| `--bench` | `#F3F4F1` | page background |
| `--surface` | `#FFFFFF` | panels, dialogs, inputs |
| `--sunken` | `#EAECE7` | table headers, hover rows, disabled fields |
| `--line` | `#D9DCD4` | borders, dividers |
| `--line-strong` | `#848880` | input borders (3:1 against the surface); not used for calendar grid lines |
| `--grid-hour` | `#CBCFC5` | calendar hour lines (decorative, softer than `--line-strong`) |
| `--grid-half` | `#E1E4DC` | calendar half-hour lines (softer still) |
| `--ink` | `#16201C` | body text and headings |
| `--ink-muted` | `#55605A` | secondary text |
| `--ink-faint` | `#626C66` | placeholders, disabled text |
| `--cobalt` | `#1F47C4` | primary buttons, links, my bookings, focus ring |
| `--cobalt-strong` | `#1A3BA3` | primary hover and pressed |
| `--cobalt-tint` | `#E3EAFB` | selected rows, today column, selection preview |
| `--on-cobalt` | `#FFFFFF` | text on cobalt |
| `--busy` | `#EAECE7` | someone else's booking on the calendar: fill |
| `--busy-edge` | `#B4B9AF` | its 1px edge |
| `--busy-hatch` | `#848880` | the lines of its hatch |
| `--scrim` | `rgb(9 18 14 / 0.45)` | the dim layer behind dialogs, sheets and drawers (a deep green-black) |

Status (background / text / border): pending `#FBEFD2 / #6B4200 / #E4B95A`; approved `--cobalt-tint / #17338F / #A9BBF2`; checked in `#DCF1E3 / #14532D / #8CCBA2`; completed `--sunken / --ink-muted / --line`; cancelled, rejected and no-show `#F7DDDA / #8A1C12 / #E8A59E`; expired `--sunken / --ink-faint / --line`; maintenance uses a diagonal hatch of `--line-strong` on `--sunken`.

### Colour, dark (a real design, not an inversion)

`--bench #0F1512`, `--surface #161D19`, `--sunken #0B100D`, `--line #27302B`, `--line-strong #606964`, `--grid-hour #353F39`, `--grid-half #252D28`, `--ink #E8ECE7`, `--ink-muted #A3ADA6`, `--ink-faint #8A958E`, `--cobalt #7C9BFF` (text, links, ring), primary button fill `#3F66E8` with white text, `--cobalt-tint #1B2748`, `--busy #28312C`, `--busy-edge #727C76`, `--busy-hatch #727C76`, `--scrim rgb(0 0 0 / 0.6)`. Status colours get dark variants with the same hue and at least the same contrast.

In dark, a "Busy" block (someone else's booking) is **lighter than the surface**, never darker, so it reads as a thing rather than a hole; its edge is at least 3:1 against the surface and its hatch stays visible. The scrim is always a darkening layer in both themes, never built from the text colour.

### Contrast rules

Body and small text at least 4.5:1, large text and UI borders at least 3:1, in both themes. Add a unit test (`tokens.contrast.test.ts`) that computes WCAG ratios for every text-on-background pair listed above and fails below the thresholds. The calendar grid lines are decorative (no minimum ratio) but must stay visible on the surface and softer than `--line-strong`; the Busy block's label, fill, hatch and dark-theme edge (3:1) and the heatmap ramp are tested as well.

### Heatmap and charts

Single hue, sequential: from `--cobalt-tint` to `--cobalt` in light, from `--surface` to `#7C9BFF` in dark, in five steps `--heat-1` to `--heat-5` (light `#E3EAFB #B2C1ED #8198E0 #5070D2 #1F47C4`; dark `#2A3647 #3F4F75 #5369A3 #6882D1 #7C9BFF`, starting just above the surface so the lightest step is visible). Zero cells stay visible as an outlined empty cell (a `--line` outline), so the grid is readable. No rainbow, no gradient washes as decoration.

### Type

- **IBM Plex Sans** for everything, plus **IBM Plex Sans Condensed** for the calendar time axis, big figures and dense numeric tables. Self-host with `@fontsource` packages (no CDN: the app must work offline in Docker and as a PWA). Weights 400, 500, 600 only.
- Scale (px): 12, 13, 15 (body), 17, 20, 24, 32. Mobile body 16 and form fields 16 so iOS does not zoom.
- Body line-height 1.5, headings 1.2 with `letter-spacing: -0.01em`. Prose lines at most 72 characters. `font-variant-numeric: tabular-nums` on every time, date and figure.
- Do not use all-caps labels, tracked-out eyebrows above headings, or a single accented word in a headline. No monospace for small labels.

### Shape, space, depth

- Spacing scale 4, 8, 12, 16, 24, 32, 48.
- Radius by role: 4 for calendar blocks and chips, 6 for buttons and inputs, 10 for panels, dialogs and sheets. Fully round only for status dots. Never one radius for everything.
- No shadow on panels. Separate surfaces by tone and a 1px line. Shadow only on things that float (dialogs, menus, toasts, the mobile sheet).
- Focus: a 2px `--cobalt` ring with 2px offset on every interactive element, always visible on keyboard focus.
- Touch targets at least 44 by 44 on phones.

### Motion

No entrance animations and no hover animation on cards. State changes use 120 to 160 ms ease-out (button press, toggle, row selection). The single deliberate moment: a booking block settles into place when a booking succeeds. Everything respects `prefers-reduced-motion`.

## 4. Layout and navigation

- **Desktop (1024 and up):** a left rail, 232 px wide. Top: logomark and wordmark. Groups: *Book* (Resources, My bookings, Scan), *Manage* (Approvals, Analytics, Admin), each shown only if the role allows (gating stays UI-only). Bottom: the user chip (name, role) with a menu holding theme toggle and Sign out.
- **Tablet (768 to 1023):** the rail collapses to a 64 px icon rail with tooltips.
- **Phone (under 768):** a slim top bar with the page title and the user menu, and a bottom tab bar with at most five items. Scan sits in the centre as the prominent action. Anything beyond five goes in a "More" sheet.
- **Page structure:** `PageHeader` (title, one plain line of description, actions on the right), then content. Content max width 1200 px, except the calendar, which uses the full width.
- **Wide screens:** every page has a max content width, centred in the space beside the rail. Split layouts (sign-in, register) cap and centre each side's content inside its own half (about 520 px for the left side, 380 px for a form), and the left side's logo and footer align to that same column. Nothing stretches to the full viewport width except the calendar. Check every screen at 1920 px as well as the sizes in §8.
- **Logo:** a 3 by 3 grid of small squares with one filled in cobalt (a booked slot). Used as favicon, PWA icons and the wordmark prefix.
- **Theme:** light by default, including on a first visit when the system prefers dark (the system's colour-scheme preference is not followed). A toggle in the user menu switches light and dark and remembers the choice; a stored choice always wins (`localStorage` in try/catch, with a tiny inline script in `index.html` that sets `data-theme` before first paint so there is no flash). Also set `theme-color` for both themes and update the PWA manifest colours.

## 5. Components (build once in `client/src/components/ui`, reuse everywhere)

Button (primary, secondary, quiet, danger; loading state keeps width), IconButton, Input, Select, Textarea, Field (label above, helper text, inline error linked with `aria-describedby`), Checkbox, Switch, StatusPill (colour + icon + label), Badge, Table (sticky header, row hover, mobile stacked rows), Dialog and ConfirmDialog (one pattern for every confirm), Sheet (mobile bottom sheet), Toast, EmptyState (message plus next action), Skeleton (matches the layout it replaces), Tabs, PageHeader, Tooltip, Avatar (initials), Stat (a figure with a plain label), Logo.

Icons: `lucide-react`, one stroke width everywhere. Icons support text; they do not replace it, except in the collapsed rail and the phone tab bar (which also keep text labels).

## 6. Screen guidance

- **Login and Register:** on desktop a two-column layout. Left: one plain sentence about what LabDesk does and a small static strip of the timeline motif. Right: the form. On phone only the form. Department picker must never leave the form in an invalid state (it already guards this; keep it).
- **Resources:** a table-like list on desktop and stacked rows on phone, each showing name, location, capacity, department, whether approval is needed and today's availability at a glance. Search and filter in one row. Not a grid of identical cards.
- **Resource calendar (the signature screen):** see section 7.
- **My bookings:** grouped (Upcoming, Past), each row shows resource, time range, status pill, one clear action. Cancel always uses ConfirmDialog.
- **Series:** list with the recurrence in words ("Every Tuesday and Thursday until 12 Dec"), skips shown as a quiet sub-list.
- **Scan and check-in:** large camera area, one instruction line, a result state that is unmissable (checked in, checked out, too early, too late, wrong booking), each with the reason and the next step.
- **Approvals:** a queue. Each item shows who, what, when, why. Approve is primary, Reject is secondary and asks for a comment. Items leave the list without a reload (keep existing behaviour).
- **Analytics:** no four identical cards. One continuous summary strip with four figures separated by dividers (Plex Sans Condensed numerals, plain labels). Then the heatmap, then utilization by resource as rows with a thin bar, then the idle ranking and no-shows as proper tables. Subtitle writes the range in words ("18 Aug to 14 Oct"), without middle-dot strings.
- **Admin:** tabs (Resources, Users, Maintenance, Departments or whatever exists today). Forms are two-column on desktop and one-column on phone. Destructive actions use ConfirmDialog.

## 7. The week calendar

- Time axis in Plex Sans Condensed with ruler ticks: a long tick at each hour, a short tick at each half hour.
- Hour lines in `--grid-hour`, half-hour lines in `--grid-half`, like graph paper: their own tokens, softer than `--line-strong`, which is kept for input borders. Outside business hours: a slightly darker `--sunken` band, not hidden.
- Today's column in `--cobalt-tint`. A "now" line in `--cobalt` with a small notch on the axis.
- Blocks, radius 4:
  - my booking: solid `--cobalt`, white text, time range and purpose.
  - someone else's booking: `--busy` with a `--busy-edge` border and a left-edge diagonal hatch in `--busy-hatch` (lighter than the surface in dark); show only what the app already shows today.
  - pending: amber with a dashed border and the word "Pending".
  - maintenance: hatched, labelled "Maintenance".
- While dragging: a dashed `--cobalt` outline with a live label "11:00 to 12:00, 1 h". The drag still stops at a busy slot (existing behaviour).
- On success the new block settles in with a short 160 ms scale and fade. This answers the person's own action and is the only flourish; nothing else animates on load.
- The booking panel is a right-hand side panel on desktop and a bottom Sheet on phone.
- **Phone (under 768):** day view instead of a sideways-scrolling week. A 7-day strip at the top (today marked, swipe or arrows to change week), one full-width day timeline below. Selecting a slot works by tap start then tap end, with the same collision rule. Reuse the existing pure grid-maths functions; add pure tests for the two-tap selection logic. Desktop pointer-drag stays as it is.

## 8. Accessibility and quality floor

- Visible keyboard focus everywhere, logical tab order, dialogs trap focus and return it.
- All status conveyed by text and icon as well as colour.
- `prefers-reduced-motion` respected. The theme does not follow `prefers-color-scheme`: with nothing stored it is light, and a stored choice always wins.
- No horizontal page scroll at 360 px wide. Test at 360, 390, 768, 1024, 1440, in both themes.
- Do not change any behaviour, route, API call, error code or test intent while restyling.
