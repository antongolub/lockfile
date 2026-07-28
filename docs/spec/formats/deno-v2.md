# `deno-v2`

> Status: implemented preview adapter.
> Marker: top-level `version: "2"`.
> Certification: parse/emit structural proof and measured-corpus replay; no
> separately obtainable pinned producer.

`deno-v2` is the concrete public identity for Deno lockfile wire version 2.
It accepts no other version. Unchanged input replays byte-exactly and
same-identity mutation emits the v2 layout:

```text
version
remote
npm.specifiers
npm.packages
```

V2 uses name-to-native-id dependency maps and has no JSR, workspace, or
redirect carrier. Unknown top-level keys are preserved individually.

Supported targets are `deno-v3`, `deno-v4`, and all 16 Node-family formats
(the latter require sibling manifest evidence). `deno-v2 -> deno-v5` is
fail-closed because v2 lacks complete v5 package metadata and proof that
dependency, optional-dependency, and peer edges were correctly reclassified.
Inbound conversions from v3, v4, and v5 are supported; unrepresentable native
sections and v5-only entry fields are reported with target-addressed loss
diagnostics.

Shared schema, integrity, native-id, corpus, and projection details:
[`_deno.md`](./_deno.md).
