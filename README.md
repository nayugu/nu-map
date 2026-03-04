# NU Map

An unofficial, browser-based degree planner for Northeastern University. Drag courses onto a semester timeline, validate graduation requirements, and export a PDF. No backend, no login.

> Not affiliated with or endorsed by Northeastern University. Always verify your plan with an advisor and DegreeWorks.

---

## What it does

- **Drag-and-drop planning** across a trimmed semester timeline (set your entry/grad dates, add co-op blocks, mark your current semester)
- **Live prereq/coreq validation** with SVG overlay lines: red for wrong order, yellow for misplaced coreqs
- **Graduation requirements panel:** pick your major, concentration, and minors; sections, AND/OR groups, and elective pools validate live against your placed courses
- **NUPath tracking:** 13-attribute grid shows which NUPath requirements your plan covers
- **Course info panel:** full details, interactive prerequisite chips (click to navigate, drag to place)
- **PDF export:** one-page graduation summary + full semester schedule, auto-closes after print
- **Dark / light themes**, auto-save to `localStorage`, undo with Cmd+Z

---

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # output → dist/
```

The app loads `public/all-courses.json` on startup, falling back to the live API. To bundle a local snapshot:

```bash
curl https://husker.vercel.app/courses/all -o public/all-courses.json
```

---

## Credits

| | |
|---|---|
| **Course catalog** | [ninest/nu-courses](https://github.com/ninest/nu-courses), built and maintained by [@ninest](https://github.com/ninest) |
| **Graduation requirements** | [sandboxnu/graduatenu](https://github.com/sandboxnu/graduatenu), built by [@denniwang](https://github.com/denniwang) and [Sandbox](https://github.com/sandboxnu) |
| **Built with** | [Claude Sonnet 4.6](https://www.anthropic.com/claude) (Anthropic) |
