/**
 * Согласование возможностей клиента и исполнителя (заглушка до реального API рантайма).
 *
 * @param {Record<string, unknown>} client — например DEFAULT_STUDIO_CAPABILITIES + расширения
 * @param {Record<string, unknown>} runtime — ответ сервера / executor
 * @returns {{ ok: boolean, requiredFeatures: string[], missingCapabilities: string[], notes: string[] }}
 */
export function negotiateCapabilities(client, runtime) {
  const notes = [];
  const missing = [];
  const c = client || {};
  const r = runtime || {};

  if (r.maxGraphNodes != null && c.maxGraphNodes != null && r.maxGraphNodes < c.maxGraphNodes) {
    missing.push('maxGraphNodes');
    notes.push('Исполнитель ограничивает размер графа сильнее, чем ожидает клиент.');
  }

  if (r.dialect && c.dialect && r.dialect !== c.dialect) {
    notes.push(`Несовпадение диалекта: клиент ${c.dialect}, исполнитель ${r.dialect}.`);
  }

  const rf = Array.isArray(r.requiredFeatures) ? r.requiredFeatures : [];
  const ok = missing.length === 0;

  return {
    ok,
    requiredFeatures: rf,
    missingCapabilities: missing,
    notes,
  };
}
