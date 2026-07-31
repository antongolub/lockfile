import type { FormatId, YarnBerryFormatId } from '../format-contract.ts'
import type {
  Graph,
  OverrideConstraint,
  TarballKey,
} from './graph.ts'
import type { DiagnosticCode } from './diagnostics.ts'
import type { PackumentVersion } from './registry.ts'
import type {
  InternalProjectEvidenceInput,
  PackageManifestEvidence as InternalPackageManifestEvidence,
  PmConfigEvidence as InternalPmConfigEvidence,
} from '../../completeness/types.ts'
import {
  internalOverride,
} from './graph.ts'

export type TargetRequest =
  | Readonly<{
      format: YarnBerryFormatId
      managerVersion?: string
      cacheKey?: string
    }>
  | Readonly<{
      format: Exclude<FormatId, YarnBerryFormatId>
      managerVersion?: string
    }>

export type TargetInput = FormatId | TargetRequest

export type PinnedTargetRequest = TargetRequest & Readonly<{
  managerVersion: string
}>

export type Verification =
  | 'unverified'
  | 'graph-validated'
  | 'integrity-verified'
  | 'producer-verified'
  | 'frozen-verified'

export type PackageManager =
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'bun'
  | 'deno'
  | 'lockgraph'

export interface PmConfigEvidence {
  readonly kind: 'pm-config'
  readonly manager: Exclude<PackageManager, 'lockgraph'>
  readonly version: string
  readonly source: string
  readonly surface: 'overrides'
  readonly coverage: 'complete'
  readonly overrides: readonly OverrideConstraint[]
}

export interface PackageManifestEvidence {
  readonly kind: 'package-manifests'
  readonly authority: 'full-packument' | 'version-manifest' | 'tarball-manifest'
  readonly manifests: Readonly<Record<TarballKey, PackumentVersion>>
}

export interface TargetOracleEvidence {
  readonly kind: 'target-oracle'
  readonly graph: Graph
  readonly target: PinnedTargetRequest
  readonly verification: Exclude<Verification, 'unverified' | 'graph-validated'>
  readonly platform: string
}

/** Publicly extensible registry of already-attested evidence values. */
export interface EvidenceInputMap {
  readonly 'pm-config': PmConfigEvidence
  readonly 'package-manifests': PackageManifestEvidence
  readonly 'target-oracle': TargetOracleEvidence
}

export type EvidenceInput = EvidenceInputMap[keyof EvidenceInputMap]
export type ProjectEvidenceInput = Exclude<EvidenceInput, TargetOracleEvidence>
export type ManifestCoverage = 'partial' | 'complete'
export type RequirementStatus = 'satisfied' | 'unsatisfied' | 'unassessed'

export interface RequirementAssessment {
  readonly key: string
  readonly status: RequirementStatus
  readonly reasons: readonly DiagnosticCode[]
}

export type ConversionContract = 'snapshot' | 'policy' | 'install'

export interface ConversionAssessment {
  readonly status: RequirementStatus
  readonly contract: ConversionContract
  readonly target: TargetRequest
  readonly manifestCoverage: ManifestCoverage
  readonly requirements: readonly RequirementAssessment[]
}

/** @internal Converts the public policy spelling to the core representation. */
export function internalPmConfig(value: PmConfigEvidence): InternalPmConfigEvidence {
  return Object.freeze({
    ...value,
    overrides: Object.freeze(value.overrides.map(internalOverride)),
  })
}

/** @internal Converts already-attested public evidence to the proof engine. */
export function internalEvidence(value: ProjectEvidenceInput): InternalProjectEvidenceInput {
  switch (value.kind) {
    case 'pm-config':
      return internalPmConfig(value)
    case 'package-manifests':
      return value as unknown as InternalPackageManifestEvidence
  }
}
