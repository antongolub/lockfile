# `deno-v4`

> Status: implemented preview adapter.
> Marker: top-level `version: "4"`.
> Verified writer: Deno 2.2.8.
> Native gate: cold-cache clean/tampered/restored byte identity.

`deno-v4` accepts only wire version 4. Its known layout is:

```text
version
specifiers
jsr
npm
remote
redirects
workspace
```

Npm dependency references are compact arrays. Unknown top-level keys are
preserved individually.

Supported Deno targets are v2 and v3; every emitted v4 target is certified by
the pinned Deno 2.2.8 frozen oracle. All 16 Node-family targets are supported
with sibling manifest evidence. `deno-v4 -> deno-v5` is fail-closed because
v4 lacks complete v5 package metadata and proof of correct
dependency/optional/peer edge reclassification. Inbound v2, v3, and v5
conversions are supported with target-addressed loss diagnostics.

Shared schema, integrity, native-id, corpus, and projection details:
[`_deno.md`](./_deno.md).
