/** Версия минимального project manifest (только совместимость / negotiation). */
export const PROJECT_MANIFEST_FORMAT_VERSION = 1;

/**
 * @deprecated Использовать PROJECT_MANIFEST_FORMAT_VERSION.
 * Оставлено для чтения старых артефактов и миграций.
 */
export const PROJECT_DOCUMENT_SCHEMA_VERSION = PROJECT_MANIFEST_FORMAT_VERSION;

/** Версия схемы полного graph document (manifest + ir + ast + buildGraph + ui). */
export const PROJECT_GRAPH_DOCUMENT_SCHEMA_VERSION = 1;

export const PROJECT_GRAPH_DOCUMENT_TYPE = 'cicada-project-graph';

/** Возможности клиента студии по умолчанию (для negotiateCapabilities). */
export const DEFAULT_STUDIO_CAPABILITIES = Object.freeze({
  maxGraphNodes: 50_000,
  supportsSemanticIds: true,
  supportsMerkleHashes: true,
  dialect: 'cicada-dsl-ru',
});
