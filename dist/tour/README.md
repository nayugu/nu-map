# Feature tour assets

The live 6-step tour ([src/ui/FeatureTour.jsx](../../src/ui/FeatureTour.jsx)) loads
these by name. Captions live in `src/locales/*.js` under `tour.step.N.*` (the
images/videos are language-neutral). Videos autoplay muted + loop.

| # | File | Step |
|---|------|------|
| 1 | `01-requirements.mp4` | Grad → major → minor → requirements + NUPath |
| 2 | `02-search.mp4`       | Search + filter + drag |
| 3 | `03-coop.mp4`         | Add a co-op |
| 4 | `04-prereqs.png`      | Prerequisite / coreq arrows |
| 5 | `05-class.png`        | Class description / availability / instructor |
| 6 | `06-plans.mp4`        | Plans → export PDF / share |

## Re-encoding a replacement clip
Videos are H.264 / yuv420p / no audio / faststart so they autoplay in every
browser (raw `.mov` won't play in Firefox). To process a new recording:

```
ffmpeg -i input.mov -an -vf "scale='min(1200,iw)':-2" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 26 -movflags +faststart 0X-name.mp4
```

Keep each clip ~0.5–1.5 MB. To add/remove/reorder steps, edit the `STEPS`
array in FeatureTour.jsx and the matching `tour.step.N` keys in all 8 locales.
