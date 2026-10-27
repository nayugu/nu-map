# Roadmap: how to edit

Each `.md` file here is one item on [numap.app/roadmap](https://numap.app/roadmap).
Edit, commit, push. The page updates on the next deploy.

## What a file looks like

```md
---
status: planned        ← which section it's in (see below)
date: 2026-10          ← when we heard it (sorts the list, newest first)
asks: 1                ← optional: how many people asked for it
credit: Lily H.        ← optional: shows "Thanks to Lily H."
top: true              ← optional: pin to the top of its section
---
# The title

The description. A blank line starts a new paragraph.
Links: [the catalog](https://catalog.northeastern.edu) or [our story](/story).
```

(The `← …` notes are only explanations. Don't type them.)

**The filename is the link:** `summer-graduation.md` → `numap.app/roadmap#summer-graduation`.
Lowercase-with-dashes, and **never rename** a file: people have the link.

## Status → section

| `status:` | Section |
|---|---|
| `known` | Known issues |
| `planned` | Planned |
| `maybe` | Maybe |
| `declined` | Not planned |
| `shipped` | Shipped (also needs `shipped: 2026-11-03`, the day it went live) |

## Common tasks

- **New feedback:** copy an existing file, rename it, change the text. Put `asks: 1`.
- **Same idea again:** open its file, add 1 to `asks`.
- **They said Yes to credit:** add `credit: First L.`. Look up their email in
  Northeastern Outlook for the first name. Never write an email.
- **It shipped:** change `status: shipped` and add `shipped: YYYY-MM-DD`. Keep the file.
- **We decided against it:** `status: declined`, and say why in the description.

## If you make a mistake

The build stops and names the file and the problem, e.g.
`roadmap/foo.md: status must be one of: known, planned, maybe, declined, shipped`.
To check before pushing, run `npm run test:unit`, or open `/roadmap.html` with `npm run dev`.

Body text is plain paragraphs and links only (no lists or headings).
