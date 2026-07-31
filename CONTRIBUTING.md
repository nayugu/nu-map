# Contributing

PRs and issues are welcome. NU Map is a two-student project and we're happy to
have help — bug reports, data corrections, translations, and forks for other
universities especially.

For the mechanics of the project (architecture, data pipeline, how to run it),
start with the [README](README.md). Data corrections have their own format and
rules: see [`data/northeastern/patches/CONTRIBUTING.md`](data/northeastern/patches/CONTRIBUTING.md).
Note that **data fixes must go in the scrape scripts or the patch files** —
anything else gets overwritten by the next scheduled scrape.

## House rules

- Conventional commit subjects (`type: description`). For features and fixes,
  add a body of bullet points explaining the mechanism, not just the what.
- Every user-facing string needs a hand-written translation in all 8 locales
  under `src/locales/`.
- Branch → PR → **merge commit**. Never squash — it destroys the individual
  commit history the moment the branch ref is deleted.
- The repo is public. Keep notes and comments whiteboard-safe.

## Contributor terms

*Plain-language summary, non-binding: you keep the copyright in what you write,
and you let us ship it under both of the project's licenses. There is nothing to
sign. If that doesn't work for you, tell us before you write code.*

The following terms are stated because the Work is dual-licensed under
[`LICENSING.md`](LICENSING.md), and the offering of a commercial license under
Option B requires the Licensor to hold rights sufficient to cover the entirety of
the Work, including contributed material. Defined terms have the meanings given in
`LICENSING.md` §1.

By submitting a Contribution — meaning any pull request, patch, translation, data
correction, attachment, or other submission of copyrightable material to the Work
— You represent, warrant, and agree as follows.

**1. Originality and right to submit.** The Contribution is Your original work, or
You are otherwise entitled to submit it under terms compatible with those of the
Work; and where the Contribution incorporates material of a third party, You have
identified that material and its governing terms in the submission.

**2. Retention of copyright.** You retain all copyright in Your Contribution. No
assignment or transfer of ownership is required or effected by these terms, and
You remain free to license or exploit Your Contribution otherwise.

**3. Grant of license to the Licensor.** You grant the Licensor a perpetual,
worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce,
modify, adapt, publicly display, publicly perform, distribute, and sublicense the
Contribution, alone or as incorporated in the Work, **under either or both of the
options at `LICENSING.md` §2**, including without limitation under the commercial
terms set out in [`COMMERCIAL.md`](COMMERCIAL.md).

**4. No consideration.** No payment, royalty, or other consideration is promised,
owed, or implied in respect of a Contribution or of any license granted under
clause 3.

**5. Acceptance.** Submission of a Contribution constitutes agreement to these
terms. No separate instrument, contributor-license-agreement signature, or
electronic assent is required. Should any of these terms be unacceptable to You,
raise the matter by issue before commencing work; the Licensor would prefer to
resolve it than to decline a Contribution it would otherwise welcome.

**6. Attribution of contributors.** Your Contribution remains attributed to You in
the public version-control history of the Work, which the Licensor maintains as a
permanent record of authorship.

### Matters reserved between the joint authors

> *This section records internal action items for Nathan Gu and Matthew Gu. It is
> not a term applicable to outside contributors and confers no rights.*
>
> The Work is a joint work of two authors. Under United States law either joint
> author may grant a non-exclusive license acting alone, while owing the other an
> accounting for profits so received; a commercial license under Option B could
> therefore be executed by one author and would nonetheless give rise to an
> obligation to the other.
>
> Matthew's contributions predate clause 3. Clause 3 alone was never quite enough
> for them: a non-exclusive licence given for nothing is revocable at will, and a
> paying licensee needs to know neither of us can withdraw the rights it relies on.
>
> **That is settled.** Both authors have signed
> [`docs/co-ownership-agreement.md`](docs/co-ownership-agreement.md), which grants
> each the other identical irrevocable rights and fixes the division of proceeds.
> Clause 3 above continues to govern third-party contributions.
