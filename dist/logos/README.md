# Curated company logos

Logos pinned by hand. The resolver checks this folder **first**; only when a
company is not pinned does it go looking at Google's favicon service, the
company's own `/favicon.ico` and `/apple-touch-icon.png`, and unavatar
(`src/core/companyLogo.js`). A pinned logo is used as-is — not scored against
those sources, and not held to any minimum size.

Pin one when the automatic answer is wrong, ugly, or missing. Sony Pictures
Imageworks publishes no usable favicon anywhere, so without a pinned logo its
co-op card renders blank.

## Adding one

Drop the image in this folder, named after what it should match, then run
`npm run logos`.

```
public/logos/imageworks.com.webp             ← matched by domain
public/logos/sony-pictures-imageworks.png    ← matched by company name
```

**The filename is the match.** A dot in it means a domain; no dot means a
company name in kebab-case (capitals are forgiven, spaces and underscores are
not). Names are folded the way a person would
read them — case, accents, punctuation, `&` vs `and` and legal suffixes are
all ignored — so `sony-pictures-imageworks.png` matches a work term typed as
"Sony Pictures Imageworks, Inc.". Domain wins over name when both are pinned.

A filename that is neither (`Screenshot 2026-08-11 at 11.23.51 AM.png`) is a
**hard error**, not a guess: a folder of camera dumps that quietly "work" is
worse than one that tells you to rename them.

A company with two domains gets two files. They are a couple of kB, and it
keeps the rule "the filename is the match" true.

Prefer SVG. It is left untouched and stays sharp at every size.

## What `npm run logos` does

1. **Crops each raster to a square — minimally.** It takes the largest square
   the image can give (`min(width, height)`) and centres it on the logo. The
   padding around a mark is part of how it reads, so it is kept; the content
   box only decides *where* the square sits. The one exception, which fires on
   nothing normal, is a mark marooned in a canvas of mostly background, which
   would otherwise scale down to a speck.
2. **Scales down to 256px**, never up.
3. **Re-encodes as PNG and WebP and keeps the smaller** (usually WebP, often
   4–5× smaller).
4. **Writes `index.json`**, the list of files — it exists only because a
   browser cannot list a directory.

⚠ Processing **replaces the file you dropped in**, including its extension
(`apple.com.png` → `apple.com.webp`). Keep your original somewhere else if you
might want to re-crop it differently later.

Nothing to crop and nothing to scale means the file is left byte-for-byte
alone, so re-running is free and WebP's lossy encoding never compounds.

`npm run logos:check` verifies the folder and the index without writing
anything — it is what the test suite and CI run.

There is also `node scripts/build-logos.js --add <path|url> --as imageworks.com`
to pull a file or URL in under the right name, for when you have a link rather
than a file.

## Licensing

The repo is public and these are other people's trademarks. Keep to assets a
company publishes for identification (favicons, press-kit marks) or to a
public-domain source. Do not redraw a mark and pass it off as official.
