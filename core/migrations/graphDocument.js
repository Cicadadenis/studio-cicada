import {
  PROJECT_GRAPH_DOCUMENT_SCHEMA_VERSION,
  PROJECT_GRAPH_DOCUMENT_TYPE,
} from '../manifests/constants.js';
import {
  GRAPH_DOCUMENT_BLOB_KEYS,
  graphBlobRefKey,
} from '../manifests/graphDocumentRefs.js';

const registry = [
  {
    to: 1,
    id: 'cicada-project-graph-v1',
    description: 'Первая схема document: manifest, ir, ast, buildGraph, ui.',
    apply(doc) {
      const next = { ...(doc || {}) };
      next.documentType = PROJECT_GRAPH_DOCUMENT_TYPE;
      next.schemaVersion = 1;
      if (next.manifest == null || typeof next.manifest !== 'object') next.manifest = {};
      for (const k of GRAPH_DOCUMENT_BLOB_KEYS) {
        const rk = graphBlobRefKey(k);
        const hasRef = typeof next[rk] === 'string' && next[rk].length > 0;
        if (next[k] === undefined && !hasRef) next[k] = null;
      }
      return next;
    },
  },
];

export function migrateProjectGraphDocument(
  doc,
  targetVersion = PROJECT_GRAPH_DOCUMENT_SCHEMA_VERSION,
) {
  let current = { ...(doc || {}) };
  let v = typeof current.schemaVersion === 'number' ? current.schemaVersion : 0;
  const trace = [];
  while (v < targetVersion) {
    const step = registry.find((s) => s.to === v + 1);
    if (!step) {
      throw new Error(`Нет миграции graph document с версии ${v} на ${v + 1}`);
    }
    current = step.apply(current);
    v = current.schemaVersion;
    trace.push(step.id);
  }
  return { doc: current, trace };
}

export { registry as PROJECT_GRAPH_DOCUMENT_MIGRATIONS };
