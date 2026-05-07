import { PROJECT_MANIFEST_FORMAT_VERSION } from '../manifests/constants.js';

const registry = [
  {
    to: 1,
    id: 'project-manifest-v1',
    description: 'Минимальный manifest: projectFormatVersion + requiredFeatures.',
    apply(doc) {
      const src = { ...(doc || {}) };
      const rf = Array.isArray(src.requiredFeatures) ? [...src.requiredFeatures] : [];
      const dialect = typeof src.dialect === 'string' ? src.dialect : undefined;

      /** @type {Record<string, unknown>} */
      const next = {
        projectFormatVersion: 1,
        requiredFeatures: [...new Set(rf)].sort(),
      };
      if (dialect) next.dialect = dialect;

      return next;
    },
  },
];

/**
 * Поднимает минимальный project manifest до целевой projectFormatVersion.
 */
export function migrateProjectManifest(doc, targetVersion = PROJECT_MANIFEST_FORMAT_VERSION) {
  let current = { ...(doc || {}) };
  let v =
    typeof current.projectFormatVersion === 'number'
      ? current.projectFormatVersion
      : typeof current.documentSchemaVersion === 'number'
        ? current.documentSchemaVersion
        : 0;

  const trace = [];
  while (v < targetVersion) {
    const step = registry.find((s) => s.to === v + 1);
    if (!step) {
      throw new Error(`Нет миграции project manifest с версии ${v} на ${v + 1}`);
    }
    current = step.apply(current);
    v = /** @type {number} */ (current.projectFormatVersion);
    trace.push(step.id);
  }

  return { doc: current, trace };
}

export { registry as PROJECT_MANIFEST_MIGRATIONS };
