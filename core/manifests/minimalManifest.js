import { PROJECT_MANIFEST_FORMAT_VERSION } from './constants.js';

/**
 * Минимальный стабильный контракт: совместимость и список фич.
 * Сюда не кладём координаты, хэши, рёбра, отладку — только то, что нужно рантайму/CLI.
 *
 * @param {{ requiredFeatures?: string[], dialect?: string }} [opts]
 * @returns {{ projectFormatVersion: number, requiredFeatures: string[], dialect?: string }}
 */
export function buildMinimalProjectManifest(opts = {}) {
  const requiredFeatures = [...new Set(opts.requiredFeatures || [])].sort();
  /** @type {{ projectFormatVersion: number, requiredFeatures: string[], dialect?: string }} */
  const out = {
    projectFormatVersion: PROJECT_MANIFEST_FORMAT_VERSION,
    requiredFeatures,
  };
  if (opts.dialect) out.dialect = opts.dialect;
  return out;
}
