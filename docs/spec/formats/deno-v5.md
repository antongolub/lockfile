# `deno-v5`

> Status: implemented preview adapter.
> Marker: top-level `version: "5"`.
> Verified writer: Deno 2.9.4.
> Native gate: cold-cache clean/tampered/restored byte identity.

`deno-v5` accepts only wire version 5. It uses the v4 top-level section layout
and compact dependency arrays, while npm entries may additionally carry
`bin`, `cpu`, `deprecated`, `optionalDependencies`, `optionalPeers`, `os`,
`scripts`, and `tarball`.

Supported Deno targets are v2, v3, and v4. Each downgrade preserves
representable resolution and integrity facts and reports every non-empty
v5-only entry field it cannot carry. All 16 Node-family targets are supported
with sibling manifest evidence.

Older Deno formats cannot target `deno-v5` in this increment: complete v5
package metadata is absent, and merely fetching registry records does not
prove that existing dependency edges were correctly reclassified as
dependency, optional dependency, or peer. Partial v5 emission is forbidden.

Unknown top-level keys are preserved individually. Same-identity native
mutation remains certified by pinned Deno 2.9.4.

Shared schema, integrity, native-id, corpus, and projection details:
[`_deno.md`](./_deno.md).
