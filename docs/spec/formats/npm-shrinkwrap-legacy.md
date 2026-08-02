# Pre-`lockfileVersion` npm shrinkwrap

> Status: intentionally unsupported (detected as a named refusal; no parser or writer).
> Updated: 2026-08-02
> Provenance: corpus-measured npm shrinkwrap generation predating npm 5.

## Identity and generation boundary

This is the npm shrinkwrap generation before `lockfileVersion` was introduced.
It is not npm lockfileVersion 1 with a missing field. Across the eight observed
real files, the nested dependency entries carry the older npm 2/3-era `from`
field 3,106 times, while `integrity` is absent everywhere. One file contains no
`from` field, so `from` is generation evidence rather than a per-file
discriminator.

Observed field inventory across those eight files:

| field | occurrences |
|---|---:|
| `version` | 3,220 |
| `from` | 3,106 |
| `resolved` | 2,945 |
| `dev` | 687 |
| nested `dependencies` | 415 |
| `optional` | 106 |
| `integrity` | 0 |

The refusal classifier is therefore deliberately narrow. It requires all
three properties:

1. no authored `lockfileVersion` field;
2. a non-empty nested `dependencies` tree;
3. no `integrity` field anywhere in the JSON value.

An integrity-bearing pre-version object, an arbitrary JSON object, or any
other undetected input does not acquire this classification.

## Refusal contract

Automatic parse refuses this shape with a thrown `LockfileError` whose public
code is `FORMAT_DETECT_FAILED`. Its single error diagnostic has code
`NPM_SHRINKWRAP_PRE_LOCKFILE_VERSION` and explains that the input is a
pre-npm-5 shrinkwrap without integrity digests, so conversion is refused.

This top-level code is intentional: a failure to infer an input format is
`FORMAT_DETECT_FAILED`, not `INVALID_INPUT`. Missing stringify target format is
a different caller error and remains `INVALID_INPUT`.

No parser treats this generation as npm-1. Doing so would drop the authored
`from` carrier, create output without digest authority, and mint
`lockfileVersion: 1` even though the source did not author that identity.

## Adjacent malformed declared npm locks

A separate named refusal covers JSON that declares a supported modern npm
lockfile version but omits the producer-required packages root entry:

- lockfileVersion 2 with exact `packages: {}`;
- lockfileVersion 3 with no `packages` key.

Those inputs throw `FORMAT_DETECT_FAILED` with one
`NPM_LOCKFILE_STRUCTURE_MISSING` error diagnostic. The message includes the
declared version and the missing `packages[""]` root. npm writes that root even
for a dependency-free project, which distinguishes a malformed empty packages
map from valid empty-project output.

## Corpus gate and adjacent supported npm-v2 shape

The original 20-file undetected census separated four disjoint classes. The
four producer-valid npm-v2 files are now detected and parsed, leaving an exact
16-file refusal census:

| class | count | Item status |
|---|---:|---|
| pre-`lockfileVersion` shrinkwrap | 8 | named refusal |
| malformed declared npm lock | 6 | named refusal |
| producer-valid dependency-free npm-v2 lock | 4 | supported by `npm-2`; no longer undetected |
| junk / non-lockfile | 2 | generic refusal |

The four valid npm-v2 files contain only `packages[""]` and omit the empty
legacy top-level `dependencies` mirror. They are not malformed: npm 8.19.4 and
npm 11.18.0 produce that exact root-only shape, and the `npm-2` adapter accepts
it under its own producer and frozen-install oracle. A v2 packages map with any
installed entry but no mirror remains a generic refusal; Item B does not widen
that boundary or relabel it with Item A's structural diagnostic.
