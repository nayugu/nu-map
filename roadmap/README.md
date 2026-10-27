# Roadmap items

Every `.md` file in this folder (except this one) is one item on
[numap.app/roadmap](https://numap.app/roadmap). Add a file, commit, and the next
deploy shows it. `npm run dev` shows it immediately at `/roadmap.html`.

## Adding an item

Create `roadmap/<name>.md`:

```md
---
status: planned
date: 2026-10
---
# Graduate after Summer A or Summer B

Right now the planner only lets you finish in a Spring or a Fall. Some
students walk in Spring and take one last set of courses in Summer A.
```

### How a file is read

1. **Between the two `---` lines:** the settings, one `key: value` per line
   (see Fields below). This block is standard Markdown "frontmatter", which
   is why GitHub shows it as a small table when you open the file.
2. **The `# ` line:** the title. Exactly one, right after the settings.
3. **Everything after the title:** the description. Plain paragraphs, with a
   blank line between them. Links look like `[the catalog](https://catalog.northeastern.edu)`
   or `[our story](/story)`.

**The filename is the link.** `summer-graduation.md` becomes
`numap.app/roadmap#summer-graduation`, which is what we send people when we
reply to feedback. Use lowercase-with-dashes, and **never rename a file** once
it's live. That would break every link we've sent.

## Fields

| field | required | meaning |
|---|---|---|
| `status` | always | `known` (confirmed problem: the description must say what to do instead), `planned`, `maybe`, `declined` (not planned: the description must say why), `shipped` |
| `date` | unless shipped | `YYYY-MM` (or `YYYY-MM-DD`): when it was reported, or when we wrote it down |
| `shipped` | when shipped | `YYYY-MM-DD` it went live |
| `top` | no | `true` pins it to the top of its section |
| `credit` | no | only for someone who answered **Yes** to the form's credit question. Always **first name + last initial**: `credit: John S.` (type their `lastname.f@northeastern.edu` into Northeastern Outlook; the directory shows the full name). |

On the page, a credited item ends with one faint line, the same in every
section: "Thanks to John S.". The date fades in beside it on hover. An item
with no `credit` shows no line at all.

## Order

- **Sections** always appear in this order: Known issues, Planned, Maybe, Not planned, Shipped.
- **Shipped** is newest first by `shipped`.
- **Every other section** shows `top: true` items first, then newest `date` first.

## Moving an item

Change its `status`. When something ships, set `status: shipped` and add
`shipped: YYYY-MM-DD`. Keep `date`. When we decide against something, set
`status: declined` and say why in the description. Don't delete shipped or
not-planned items: they're the record, and someone may have the link.

## Rules

- **Names only with permission, emails never.** The repo is public and keeps
  history forever, so a name added by mistake can't truly be removed. Use
  `credit:` only when the person answered Yes, always as "First L.". If
  several did, write them all: `credit: Lily H. and John S.`. The build
  refuses any email address, so never credit someone by their email.
- **Plain text only:** paragraphs and `[links](...)`. No lists or headings in
  the body. The build refuses anything it can't render, and names the file.
- **A mistake only affects its own item.** That item is left off the page
  until it's fixed; everything else, including the rest of the site and the
  monthly data update, carries on. You'll know because the **roadmap check**
  on GitHub turns red on your commit (and GitHub emails you), naming the file
  and the problem. To check before pushing, run
  `node scripts/check-roadmap.js`, or open the page with `npm run dev`, which
  shows a red box listing any file it left out.
- Section names, descriptions and order live in `build/roadmap.js` (`SECTIONS`).
