#!/usr/bin/env node
/**
 * capture-fixture.js — save a trimmed catalog page for contract tests.
 *
 * Commits the requirement panes plus the plan-of-study pane rather than the
 * whole document: ~20–80 KB instead of 200–400 KB, and free of the nav chrome
 * that changes for unrelated reasons. Reproducible, so fixtures can be
 * refreshed when NEU changes markup.
 *
 *   node scripts/capture-fixture.js <url> <name>
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'node-html-parser';
import { politeFetch } from './lib/catalog-cache.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/catalog');
const [url, name] = process.argv.slice(2);
if (!url || !name) { console.error('usage: capture-fixture.js <url> <name>'); process.exit(1); }

const root = parse(await politeFetch(url));
const keep = root.querySelectorAll('div[id]')
  .filter(d => /textcontainer$/.test(d.getAttribute('id') ?? ''))
  .map(d => d.outerHTML);

// Anchors sometimes sit in a bare <p> outside any pane; keep the <h1> for the name.
const h1 = root.querySelector('#page-title h1, h1.page-title, h1');
const html = `<!-- fixture: ${url} -->\n<div id="page-title">${h1?.outerHTML ?? ''}</div>\n${keep.join('\n')}\n`;

writeFileSync(join(OUT, `${name}.html`), html, 'utf8');
console.log(`${name}.html — ${(html.length / 1024).toFixed(0)} KB from ${keep.length} pane(s)`);
