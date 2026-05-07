/**
 * Нормализует узел React Flow к IR-узлу { id, type, props [, semanticId] }.
 * Используется генератором DSL, хэшами графа и IR-валидацией.
 *
 * @param {unknown} node
 * @returns {{ id: string, type: string, props: Record<string, unknown>, semanticId?: string }}
 */
export function normalizeFlowNode(node) {
  if (!node) return { id: 'unknown', type: 'message', props: {} };
  const id = node.id || 'n';
  const data = node.data || {};
  if (data.type) {
    return {
      id,
      type: data.type,
      props: { ...(data.props || {}) },
      semanticId: data.semanticId || data.id || id,
    };
  }
  return {
    id,
    type: typeof node.type === 'string' && node.type !== 'cicada' ? node.type : 'message',
    props: {},
    semanticId: id,
  };
}
