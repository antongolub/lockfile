// Public surface — ADR-0014 §3.
// Terminal facade only: internal modules import lower-level authorities directly.

export {
  LockfileError,
  type LockfileErrorCode,
  type ProjectionLoss,
  type ProjectionLossClass,
  type ProjectionRemedy,
} from './api/errors.ts'
export type {
  DependencyManifest,
  Diagnostic,
  Graph,
  GraphResult,
  Manifest,
  OverrideConstraint,
  PackageMetadataField,
} from './graph.ts'
export type {
  DenoFormatId,
  FormatId,
  ParseOptions,
  StringifyOptions,
} from './api/format-contract.ts'
export {
  check,
  detect,
  overridesOf,
  parse,
  stringify,
} from './api/format-api.ts'
export { governingOverrideFor } from './recipe/descriptor-resolve.ts'

export { completeTransitives } from './complete/tree-complete.ts'
export {
  engines,
  license,
  selectConstrained,
} from './complete/constraints.ts'
export type {
  Condition,
  ConditionContext,
} from './complete/constraints.ts'

export {
  certifyFrozen,
  convert,
  convertAssessed,
  convertProject,
  prepareFrozen,
  stringifyAssessed,
} from './convert/orchestrator.ts'
export type {
  ConvertFileSystem,
  ConvertGlobOptions,
  ConvertInput,
  ConvertOptions,
  ProjectInput,
  ProjectPathInput,
} from './convert/types.ts'

export { sourceCapabilitiesOf } from './completeness/capabilities.ts'
export {
  evidenceOf,
  withEvidence,
} from './completeness/evidence.ts'
export { completenessOf } from './completeness/profile.ts'
export { projectCompanionsOf } from './completeness/companions.ts'
export type {
  ArtifactKnowledge,
  AssessedOutput,
  AssessmentOptions,
  CompanionSetOperation,
  CompletenessContext,
  CompletenessDimension,
  CompletenessProfile,
  CompletenessResult,
  ConversionAssessment,
  ConversionContract,
  ConvertAssessedOptions,
  ConvertProjectOptions,
  EvidenceContext,
  EvidenceInput,
  EvidenceKind,
  EvidenceLedger,
  EvidenceRef,
  FrozenCandidate,
  FrozenConversionResult,
  FrozenInput,
  FrozenPreparationOptions,
  FrozenPreparationResult,
  FrozenVerificationReceipt,
  FrozenVerificationSubject,
  Knowledge,
  LayoutKnowledge,
  ManifestKnowledge,
  ManifestCoverage,
  PackageManifestEvidence,
  PeerKnowledge,
  PinnedTargetRequest,
  PmConfigEvidence,
  PolicyKnowledge,
  ProjectConversionResult,
  ProjectCompanionOptions,
  ProjectCompanionResult,
  ProjectEvidenceInput,
  RepositoryManifestEvidence,
  RequirementAssessment,
  RequirementStatus,
  ResolvedTargetCapabilities,
  SourceCapabilityResult,
  StructuralCoverage,
  TargetManager,
  TargetOracleEvidence,
  TargetProfile,
  TargetInput,
  TargetRequest,
  StringifyAssessedOptions,
  Verification,
} from './completeness/types.ts'

export { frozenRegistry } from './registry/frozen.ts'
export { fetch as defaultFetch } from 'node-fetch-native'
export {
  liveRegistry,
  type AuditOptions,
  type FromConfigOptions,
  type LiveRegistryAdapter,
  type LiveRegistryOptions,
  type RawAdvisory,
} from './registry/live.ts'
export { resolveRegistry } from './registry/config.ts'
export type {
  Ecosystem,
  RegistryConfig,
  ResolveRegistryOptions,
} from './registry/config.ts'
export {
  yarnBerryCache,
  withYarnCacheChecksums,
  type YarnBerryCacheOptions,
} from './registry/cache-yarn-berry.ts'
export { npmCache, type NpmCacheOptions } from './registry/cache-npm.ts'
export { pnpmCache, type PnpmCacheOptions } from './registry/cache-pnpm.ts'
export type {
  ArtifactRoute,
  CacheAdapter,
  Limiter,
  NpmCacheAdapter,
  NpmTarballSource,
  Packument,
  PackumentVersion,
  RegistryAdapter,
  RemoteArtifactRegistry,
  YarnBerryCacheAdapter,
  YarnBerryChecksumSource,
} from './registry/types.ts'

export { modify } from './modify/modify.ts'
export { replaceVersion } from './modify/replace-version.ts'
export type {
  ModifyResult,
  ModifyResultBase,
  Primitive,
} from './modify/modify.ts'
export type {
  ModifyContext,
  ModifyOptions,
} from './modify/context.ts'

export { optimize } from './optimize/optimize.ts'
export { pruneOrphans } from './optimize/prune.ts'
export { registryPackages } from './optimize/registry-packages.ts'
export type {
  OptimizeOptions,
  OptimizeResult,
} from './optimize/optimize.ts'

export { enrich } from './enrich/facade.ts'
export { refurbish } from './enrich/refurbish.ts'
export type {
  EnrichOptions,
  EnrichResult,
  EnrichSources,
} from './enrich/facade.ts'
export type {
  ArtifactCacheFamily,
  ArtifactCacheSpecifier,
  ArtifactSourceList,
  ArtifactSourcesInput,
  RemoteArtifactSource,
} from './enrich/artifact-sources.ts'
export {
  artifactStore,
  DEFAULT_ARTIFACT_STORE_MAX_BYTES,
} from './enrich/artifact-store.ts'
export type {
  ArtifactStoreOptions,
  ArtifactStoreSource,
} from './enrich/artifact-store.ts'
export {
  DEFAULT_ARTIFACT_MAX_LIVE_BYTES,
  DEFAULT_ARTIFACT_RESOURCE_LIMITS,
} from './recipe/artifact-envelope.ts'
export type {
  ArtifactRepresentation,
  ArtifactResourceLimits,
  ArtifactResourcePolicy,
} from './recipe/artifact-envelope.ts'
