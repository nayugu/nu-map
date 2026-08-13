// ═══════════════════════════════════════════════════════════════════
// PATHWAY INTAKE — hostile tests for the discovery/classify/rails logic.
//
// The intake runs unattended against 13 hosts and decides which pages we believe
// are authoritative for a student's degree. The failure that actually happened —
// six colleges silently reporting zero pages because of a TLS error — was not a
// logic bug; it was a MISSING RAIL. So most of what is tested here is the rails
// and the classifier's ability to say "no".
// ═══════════════════════════════════════════════════════════════════

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  parseSitemap, isCandidateUrl, classifyPage, diffInventory, contentHash,
  checkIntakeRails, courseCodesOn, cacheableText, PAGE_KIND,
} from "../../scripts/lib/pathway-intake.js";
import {
  parseRobots, isDisallowed, assertHostsReachable, newStats, checkTlsSetup,
  BROKEN_CHAIN_HOSTS,
} from "../../scripts/lib/pathway-fetch.js";

// ═══════════════════════════════════════════════════════════════════
describe("sitemap parsing survives what real sitemaps do", () => {
  test("an index is reported as an index, so the caller recurses", () => {
    const { urls, isIndex } = parseSitemap(`<?xml version="1.0"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://x.edu/page-sitemap.xml</loc></sitemap>
      </sitemapindex>`);
    assert.equal(isIndex, true);
    assert.deepEqual(urls, ["https://x.edu/page-sitemap.xml"]);
  });

  // Conflating an index with a leaf loses every URL on a two-deep site, which is
  // exactly how coe (9,882 urls) would read as empty.
  test("a leaf sitemap is NOT an index", () => {
    const { isIndex } = parseSitemap(`<urlset><url><loc>https://x.edu/a/</loc></url></urlset>`);
    assert.equal(isIndex, false);
  });

  test("XML entities in a loc are decoded", () => {
    const { urls } = parseSitemap(`<urlset><url><loc>https://x.edu/a?b=1&amp;c=2</loc></url></urlset>`);
    assert.deepEqual(urls, ["https://x.edu/a?b=1&c=2"]);
  });

  test("whitespace and newlines inside loc are tolerated", () => {
    const { urls } = parseSitemap(`<urlset><url><loc>\n   https://x.edu/a/  \n</loc></url></urlset>`);
    assert.deepEqual(urls, ["https://x.edu/a/"]);
  });

  test("junk yields nothing rather than throwing", () => {
    for (const junk of ["", null, undefined, "<html>not a sitemap</html>", "{}"]) {
      const r = parseSitemap(junk);
      assert.deepEqual(r.urls, []);
      assert.equal(r.isIndex, false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("candidate matching", () => {
  test("real pathway URLs match", () => {
    for (const u of [
      "https://www.khoury.northeastern.edu/programs/plusone-program-with-ms-in-cs/",
      "https://cos.northeastern.edu/admissions/undergraduate/plusone-accelerated/chemistry/",
      "https://mie.northeastern.edu/academics/undergraduate-studies/plusone-mece/",
      "https://cps.northeastern.edu/academics/plusone-programs/bsit-mscs-plus-one/",
      "https://camd.northeastern.edu/programs-admissions/plusone/",
    ]) assert.equal(isCandidateUrl(u), true, u);
  });

  test("routed noise — news, events, tags, resources — is rejected by URL alone", () => {
    for (const u of [
      "https://www.khoury.northeastern.edu/event/plusone-programs-undergraduate-info-session-virtual/",
      "https://cos.northeastern.edu/events/cos-plusone-information-panel/",
      "https://cos.northeastern.edu/tag/plusone/",
      "https://damore-mckim.northeastern.edu/news/emma-boughton-msaplusone21/",
      "https://damore-mckim.northeastern.edu/resources/cc-is-an-accelerated-mba-right-for-you-heres-what-to-know/",
    ]) assert.equal(isCandidateUrl(u), false, u);
  });

  // The article that got through the first sweep, and the reason classification
  // is a STAGE rather than a tighter regex.
  //
  // CSSH publishes posts at the site ROOT, with no /news/ segment:
  //   /has-russias-timeline-in-ukraine-accelerated-heres-what-you-need-to-know/
  // Nothing about that path distinguishes it from a pathway page — it contains
  // "accelerated" and sits one level deep, exactly like a real program slug. So
  // the URL gate cannot and should not try to reject it; the FETCHED PAGE does,
  // because a news article carries no course table.
  //
  // Tuning the regex to catch it (long slug? many hyphens? looks like a
  // sentence?) would be guessing at editorial style, and would eventually reject
  // a real page for being verbose.
  test("root-path editorial slips through the URL gate on purpose", () => {
    const url = "https://cssh.northeastern.edu/has-russias-timeline-in-ukraine-accelerated-heres-what-you-need-to-know/";
    assert.equal(isCandidateUrl(url), true, "the URL alone cannot tell — so we fetch it");
    const article = `<h1>Has Russia's timeline in Ukraine accelerated?</h1>
      <p>Northeastern experts weigh in on the war's pace and what comes next.</p>`;
    assert.equal(classifyPage(url, article).kind, PAGE_KIND.NOISE,
      "and the page is what settles it");
  });

  test("an unrelated page does not match", () => {
    assert.equal(isCandidateUrl("https://cos.northeastern.edu/biology/"), false);
  });

  test("a malformed URL is rejected, not thrown on", () => {
    for (const u of ["", "not a url", null, undefined, "plusone"]) {
      assert.equal(isCandidateUrl(u), false, String(u));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("classification looks at the page, not the slug", () => {
  const pathwayHtml = `<h1>PlusOne with MS in Mechanical Engineering</h1>
    <p>Open to students eligible in the following majors: BS in Bioengineering…</p>
    <table><tr><td>ME 5250</td><td>Robot Mechanics</td></tr>
    <tr><td>ME 5659</td></tr><tr><td>ME 6200</td></tr></table>`;

  test("course codes plus eligibility language ⇒ pathway", () => {
    assert.equal(classifyPage("https://mie.northeastern.edu/academics/plusone-mece/", pathwayHtml).kind,
                 PAGE_KIND.PATHWAY);
  });

  test("a noise path is noise even when the body looks like a pathway", () => {
    const r = classifyPage("https://x.edu/news/plusone-story/", pathwayHtml);
    assert.equal(r.kind, PAGE_KIND.NOISE);
    assert.equal(r.signals.isNoisePath, true);
  });

  test("links to other candidates with no course detail ⇒ index", () => {
    const html = `<h1>PlusOne Programs</h1><ul>
      <li><a href="/plusone-accelerated/chemistry/">Chemistry</a></li>
      <li><a href="/plusone-accelerated/biotechnology/">Biotechnology</a></li>
      <li><a href="/plusone-accelerated/nanomedicine/">Nanomedicine</a></li>
      <li><a href="/plusone-accelerated/marine-biology/">Marine Biology</a></li>
      <li><a href="/plusone-accelerated/bioinformatics/">Bioinformatics</a></li></ul>`;
    assert.equal(classifyPage("https://cos.northeastern.edu/plusone-accelerated/", html).kind,
                 PAGE_KIND.INDEX);
  });

  test("deadlines and scholarships with sharing language ⇒ policy", () => {
    const html = `<h1>PlusOne FAQs</h1><p>The deadline is the end of the 7th week.
      A 25% tuition scholarship applies. Students may double-count up to 16 semester hours.
      Courses outside the curriculum require a Standard Petition.</p>`;
    assert.equal(classifyPage("https://coe.northeastern.edu/accelerated-masters/plusone-faqs/", html).kind,
                 PAGE_KIND.POLICY);
  });

  test("an empty or broken page is noise, never a pathway", () => {
    for (const html of ["", "<html></html>", null, undefined]) {
      assert.equal(classifyPage("https://x.edu/plusone/", html).kind, PAGE_KIND.NOISE);
    }
  });

  // A page citing two codes in passing must not be promoted to authoritative.
  test("one or two stray course codes is not enough for pathway", () => {
    const html = `<h1>PlusOne</h1><p>For example CS 5800 or CS 5010. Eligible students…</p>`;
    assert.notEqual(classifyPage("https://x.edu/plusone/", html).kind, PAGE_KIND.PATHWAY);
  });

  test("signals are returned so a verdict can be argued with", () => {
    const r = classifyPage("https://x.edu/plusone/", pathwayHtml);
    assert.ok(r.signals.courseCodes >= 3);
    assert.equal(r.signals.hasEligibility, true);
    assert.equal(typeof r.signals.words, "number");
  });

  test("course codes are extracted in both spellings and de-duplicated", () => {
    const codes = courseCodesOn(`<p>CS 5800, CS5800 and EECE 5698 and BINF 6200</p>`);
    assert.deepEqual(codes, ["BINF6200", "CS5800", "EECE5698"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("robots.txt is honoured", () => {
  const txt = `
User-agent: *
Disallow: /admin/
Disallow: /search/

User-agent: badbot
Disallow: /
`;
  test("only User-agent: * rules are collected", () => {
    assert.deepEqual(parseRobots(txt), ["/admin/", "/search/"]);
  });

  test("rules match by prefix", () => {
    const rules = parseRobots(txt);
    assert.equal(isDisallowed("/admin/x", rules), true);
    assert.equal(isDisallowed("/search/?q=1", rules), true);
    assert.equal(isDisallowed("/programs/plusone/", rules), false);
  });

  // COE's robots.txt has 42 rules and comment lines interleaved.
  test("comments and blank lines do not become rules", () => {
    const rules = parseRobots("User-agent: *\n# a comment\n\nDisallow: /x/\n");
    assert.deepEqual(rules, ["/x/"]);
  });

  test("junk robots yields no rules rather than throwing", () => {
    for (const j of ["", null, undefined, "garbage"]) assert.deepEqual(parseRobots(j), []);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("THE RAIL: an unreachable host is never an empty one", () => {
  // This is the bug that actually happened, as a test.
  test("zero URLs WITH fetch failures is a failure", () => {
    const stats = newStats();
    stats.errors.set("coe", ["UNABLE_TO_VERIFY_LEAF_SIGNATURE: unable to verify the first certificate"]);
    const r = assertHostsReachable({ coe: 0, khoury: 2444 }, stats);
    assert.equal(r.ok, false);
    assert.match(r.failures[0], /coe/);
    assert.match(r.failures[0], /unreachable, not empty/);
  });

  // The distinction the rail exists to draw: a host can legitimately have none.
  test("zero URLs with NO failures is an honest result", () => {
    const r = assertHostsReachable({ somehost: 0 }, newStats());
    assert.equal(r.ok, true);
    assert.deepEqual(r.failures, []);
  });

  test("URLs found despite some failures is fine", () => {
    const stats = newStats();
    stats.errors.set("cos", ["HTTP 404"]);
    assert.equal(assertHostsReachable({ cos: 2445 }, stats).ok, true);
  });

  test("every broken-chain host is named, so the list cannot silently shrink", () => {
    for (const h of ["coe", "ece", "mie", "cee", "che", "bioe"]) {
      assert.ok(BROKEN_CHAIN_HOSTS.includes(h), h);
    }
  });

  test("the TLS setup check tells you what to run", () => {
    const bad = checkTlsSetup({});
    assert.equal(bad.ok, false);
    assert.match(bad.hint, /NODE_EXTRA_CA_CERTS/);
    assert.match(bad.hint, /certs\/README\.md/);
    assert.equal(checkTlsSetup({ NODE_EXTRA_CA_CERTS: "/x/incommon-rsa-ov-ssl-ca-3.pem" }).ok, true);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("intake rails catch a collapsed run", () => {
  const known = ["https://a/1", "https://a/2", "https://a/3", "https://a/4", "https://a/5"];

  test("a healthy run passes", () => {
    const r = checkIntakeRails({ hosts: 13, totalUrls: 44371, candidates: known, previousCandidates: known });
    assert.equal(r.ok, true);
  });

  test("sweeping hosts and finding zero URLs fails", () => {
    const r = checkIntakeRails({ hosts: 13, totalUrls: 0, candidates: [] });
    assert.equal(r.ok, false);
    assert.match(r.failures.join(" "), /found 0 URLs/);
  });

  test("losing most known candidates fails — discovery regressed", () => {
    const r = checkIntakeRails({
      hosts: 13, totalUrls: 40000, candidates: known.slice(0, 2), previousCandidates: known,
    });
    assert.equal(r.ok, false);
    assert.match(r.failures.join(" "), /rediscovered only 2\/5/);
  });

  test("losing ONE candidate does not fail — that is drift, not breakage", () => {
    const r = checkIntakeRails({
      hosts: 13, totalUrls: 40000, candidates: known.slice(0, 4), previousCandidates: known,
    });
    assert.equal(r.ok, true, "80% rediscovery is the floor, not a failure");
  });

  test("an unreachable host propagates into the rails", () => {
    const r = checkIntakeRails({
      hosts: 13, totalUrls: 40000, candidates: known, previousCandidates: known,
      unreachable: ["coe: 0 URLs discovered and 3 fetch failure(s)"],
    });
    assert.equal(r.ok, false);
  });

  test("a first run with no previous inventory is not penalised", () => {
    assert.equal(checkIntakeRails({ hosts: 1, totalUrls: 10, candidates: ["u"] }).ok, true);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("inventory diff drives the drift check", () => {
  test("added, gone and changed are separated", () => {
    const prev = [{ url: "a", hash: "1" }, { url: "b", hash: "2" }, { url: "c", hash: "3" }];
    const cur = [{ url: "a", hash: "1" }, { url: "b", hash: "CHANGED" }, { url: "d", hash: "4" }];
    const d = diffInventory(prev, cur);
    assert.deepEqual(d.added, ["d"]);
    assert.deepEqual(d.gone, ["c"]);
    assert.deepEqual(d.changed, ["b"]);
    assert.deepEqual(d.same, ["a"]);
  });

  test("a missing hash on either side is not reported as a change", () => {
    const d = diffInventory([{ url: "a" }], [{ url: "a", hash: "x" }]);
    assert.deepEqual(d.changed, []);
    assert.deepEqual(d.same, ["a"]);
  });

  test("empty inputs are safe", () => {
    assert.deepEqual(diffInventory(), { added: [], gone: [], changed: [], same: [] });
  });

  // Markup churn must not read as a rule change, or every WordPress deploy
  // becomes 75 pages to re-read.
  test("the content hash ignores markup and whitespace", async () => {
    const a = await contentHash(`<div class="a"><p>Requires a 3.0 GPA.</p></div>`);
    const b = await contentHash(`<section id="x"><p>   Requires a 3.0 GPA.  </p></section>`);
    assert.equal(a, b);
  });

  test("but not a change in the words", async () => {
    const a = await contentHash("<p>Requires a 3.0 GPA.</p>");
    const b = await contentHash("<p>Requires a 3.5 GPA.</p>");
    assert.notEqual(a, b);
  });

  test("scripts and styles do not affect the hash", async () => {
    const a = await contentHash("<p>text</p>");
    const b = await contentHash("<script>var x=Date.now()</script><style>.a{}</style><p>text</p>");
    assert.equal(a, b);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe("the cached text is what makes drift reviewable", () => {
  test("entities are decoded, so phrase matching and reading both work", () => {
    const t = cacheableText("<p>Co-op &amp; Experiential Learning &#038; more &ndash; see &quot;x&quot;</p>");
    assert.match(t, /Co-op & Experiential Learning & more – see "x"/);
    assert.ok(!/&amp;|&#038;|&ndash;|&quot;/.test(t), "no raw entities survive");
  });

  test("scripts, styles and comments are dropped", () => {
    const t = cacheableText(`<script>var nonce="abc123"</script><!-- build 991 -->
      <style>.a{color:red}</style><p>Requires a 3.0 GPA.</p>`);
    assert.match(t, /Requires a 3\.0 GPA\./);
    assert.ok(!/nonce|build 991|color:red/.test(t));
  });

  // The property the cache exists for: a rules change must be a small diff.
  test("it wraps at sentence boundaries rather than one giant line", () => {
    const t = cacheableText("<p>One. Two. Three.</p>");
    assert.deepEqual(t.trim().split("\n"), ["One.", "Two.", "Three."]);
  });

  test("markup churn does not change the cached text", () => {
    const a = cacheableText(`<div class="x1"><p>Requires a 3.0 GPA.</p></div>`);
    const b = cacheableText(`<section data-v="99"><p>  Requires a 3.0 GPA.  </p></section>`);
    assert.equal(a, b);
  });

  test("junk in, empty out — never a throw", () => {
    for (const j of [null, undefined, "", "<p></p>"]) {
      assert.equal(typeof cacheableText(j), "string");
    }
  });
});
