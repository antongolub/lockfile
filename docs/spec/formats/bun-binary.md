# `bun-binary` — bun `bun.lockb`

> Status: deferred (frontier — permanent non-goal; no parser/writer/detector).
> Updated: 2026-07-27
> Provenance: Reverse-engineered (anatomy only, for format distinction).

> **Permanent non-goal** — read body. `deferred` here means
> *acknowledged-and-not-pursued*, with no expectation of revisit.
> A dedicated `non-goal` status value would be more truthful, but the
> spec status vocabulary admits only `stub` / `draft` / `stable` /
> `deferred` today, so the bare `deferred` value is used and its
> permanence is stated in prose here.

`lockgraph` does **not** recognize or parse `bun.lockb` and never will.
The format is undocumented, version-fragile, and obsoleted by bun's
own move to text format in 1.2. The library's path for any bun
input is [bun-text](./bun-text.md). There is no `bun-binary` format id
or adapter; generic `detect()` returns `undefined` for the binary magic
prefix, and callers must direct users to migrate first.

The binary anatomy — a 54-byte header carrying the shebang + version
string, a `FormatVersion` enum, and tagged sections after the header —
is documented here only to distinguish the unsupported artifact. We do
not expose that knowledge through format detection or parsing.

## Compatibility

### Writers — PM semvers that *emit* this format

| PM | semver range | Default? | How to opt in |
|----|--------------|:--------:|---------------|
| bun | `<1.2`  | ✓ | original lockfile format |
| bun | `>=1.2` | – | `bun install --save-binary-lockfile` (verify exact flag name) |

### Readers — PM semvers that *install* from this format

bun's own binary reader behaviour is bun's concern, not the
library's. We do not install from or dispatch `bun.lockb` at any tier.

## File

- **Filename:** `bun.lockb`
- **Encoding:** custom binary, version-tagged.
- **Sibling files:** none required.

## Sources

- [`src/install/lockfile.zig` on main](https://github.com/oven-sh/bun/blob/main/src/install/lockfile.zig)
  — `format: FormatVersion = FormatVersion.current;` defines the
  binary writer pin.
- [Bun blog — text-based lockfile](https://bun.com/blog/bun-lock-text-lockfile)
  — historical context: `bun.lockb` was the only format until 1.1.39.
- [`src/cli/package_manager_command.zig` (bun-v1.2.5)](https://github.com/oven-sh/bun/blob/bun-v1.2.5/src/cli/package_manager_command.zig)
  — confirms there is no `bun pm cat` subcommand; the only
  `lockb → text` migration path is
  `bun install --save-text-lockfile --frozen-lockfile --lockfile-only`,
  which has install side-effects and writes a *new* text lockfile to
  disk, not a parseable dump. That is the full verdict: no read-only
  binary-to-text dump exists, so migration is the sole path.

## Recognition boundary

The file begins with the literal
shebang `#!/usr/bin/env bun\n` followed by the version string
`bun-lockfile-format-v0\n`. The format-version u32 lives at byte 42
([`bun.lockb.zig`](https://github.com/oven-sh/bun/blob/main/src/install/lockfile/bun.lockb.zig#L14-L29)).
This is documentation, not an implemented detector: the public format registry
contains no binary entry and `detect()` returns `undefined`.

## Capabilities

Not applicable — no parser, no writer, no conversion target.

## Conversion inputs

None. Users with a legacy `bun.lockb` must migrate first using
bun's own tooling:

```
bun install --save-text-lockfile --frozen-lockfile --lockfile-only
rm bun.lockb
```

This produces `bun.lock` (text), which the [bun-text](./bun-text.md)
adapter handles. The migration is bun-side; the library does not
shell out.

## Error surface

Because there is no binary format id or detector, automatic conversion fails
at the ordinary unknown-format boundary (`FORMAT_DETECT_FAILED`). No partial
parse is attempted. Applications that know the input filename is `bun.lockb`
should present the migration command above before calling lockgraph.

## Fixtures

None planned. The binary format is outside the registered input surface.

## Open questions

> None. A detector is a permanent non-goal; applications may provide a
> filename-aware migration message outside lockgraph.
