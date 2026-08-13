# Why a certificate lives in this repo

`incommon-rsa-ov-ssl-ca-3.pem` is a **public CA intermediate**, not a secret. It
is committed because six Northeastern hosts cannot be fetched from Node without
it, and the reason is a server misconfiguration we do not control.

## The misconfiguration

`coe`, `ece`, `mie`, `cee`, `che` and `bioe` (all `*.northeastern.edu`) present a
chain whose intermediate does not match the leaf's issuer:

```
leaf    CN=binary.coe.neu.edu
        issuer: InCommon RSA OV SSL CA 3      ← what actually signed it
chain   the server sends:
        InCommon RSA Server CA 2              ← a DIFFERENT CA
```

So the chain is **broken**, not merely incomplete. Consequences worth knowing:

- `curl` on macOS succeeds, because the system keychain already holds the real
  intermediate from some earlier visit. This makes the problem invisible in local
  development and present in CI.
- `node --use-system-ca` does **not** help. A trust store cannot repair a chain
  that points at the wrong issuer — verified against all six hosts.
- Node fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.

## The fix

The correct intermediate is published in the leaf's Authority Information Access
extension:

    http://crt.sectigo.com/InCommonRSAOVSSLCA3.crt   (DER)

Converted to PEM and supplied via `NODE_EXTRA_CA_CERTS`, all six hosts verify.
`scripts/lib/pathway-fetch.js` sets this up, and its `assertHostsReachable`
refuses to let a run treat an unreachable host as an empty one.

## Details, for the next person

    subject      C=US, O=InCommon LLC, CN=InCommon RSA OV SSL CA 3
    issuer       C=GB, O=Sectigo Limited,
                 CN=Sectigo Public Server Authentication Root R46
    notAfter     2035-11-05
    SHA-256      9C:0F:28:8E:AA:BB:71:40:57:01:02:0C:97:2F:81:59:
                 44:62:96:07:8D:38:59:1C:68:49:9B:12:CE:37:94:44

Adding a public intermediate narrows nothing: it lets Node trust certificates a
browser already trusts. It does **not** disable verification — that would be the
tempting one-line alternative (`NODE_TLS_REJECT_UNAUTHORIZED=0`) and it would
turn a scraper that reads a university's public pages into one that would accept
anyone's answer.

**Do not delete this as a mysterious file.** If the university ever fixes its
chain, the fix is to verify the six hosts without this PEM and then remove it —
in that order.
