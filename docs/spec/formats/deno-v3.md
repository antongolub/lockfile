# `deno-v3`

> Status: implemented preview adapter.
> Marker: top-level `version: "3"`.
> Verified writer: Deno 1.44.4.
> Native gate: cold-cache clean/tampered/restored byte identity.

`deno-v3` accepts only wire version 3. Its known layout is:

```text
version
packages.specifiers
packages.jsr
packages.npm
remote
workspace
```

Npm dependency references are name-to-native-id maps. Unknown top-level keys
are preserved individually.

Supported Deno targets are v2 and v4; every emitted v3 target is certified by
the pinned Deno 1.44.4 frozen oracle. All 16 Node-family targets are supported
with sibling manifest evidence. `deno-v3 -> deno-v5` is fail-closed because
v3 lacks complete v5 package metadata and proof of correct
dependency/optional/peer edge reclassification. Inbound v2, v4, and v5
conversions are supported with target-addressed loss diagnostics.

Shared schema, integrity, native-id, corpus, and projection details:
[`_deno.md`](./_deno.md).
