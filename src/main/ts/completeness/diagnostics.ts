import type { Diagnostic } from '../graph.ts'

export type PackageMetadataDiagnosticCode =
  | 'COMPLETENESS_PACKAGE_METADATA_INCOMPLETE'
  | 'COMPLETENESS_PACKAGE_METADATA_MISMATCH'
  | 'COMPLETENESS_PACKAGE_METADATA_SOURCE_UNSUPPORTED'

export function packageMetadataDiagnostic(
  code: PackageMetadataDiagnosticCode,
  subject: string,
  message: string,
): Diagnostic {
  return Object.freeze({
    code,
    severity: 'warning',
    subject,
    message,
    data: Object.freeze({ dimension: 'packageMetadata', subject }),
  })
}

export function manifestExtensionDependencyMismatchDiagnostic(
  subject: string,
  sources: readonly string[],
): Diagnostic {
  return Object.freeze({
    code: 'COMPLETENESS_MANIFEST_EXTENSION_DEPENDENCY_MISMATCH',
    severity: 'warning',
    subject,
    message: 'dependency facts may differ because the source package manager extended the published manifest',
    data: Object.freeze({
      dimension: 'manifestKnowledge',
      sources: Object.freeze([...sources]),
    }),
  })
}
