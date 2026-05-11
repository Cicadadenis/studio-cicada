const RENDER_UI_ACTION_TYPES = new Set([
  'reply',
  'message',
  'caption',
  'photo',
  'media',
  'video',
  'audio',
  'document',
  'send_file',
  'sticker',
  'poll',
]);

export const UI_ATTACHMENT_GROUPS = Object.freeze(['replies', 'buttons', 'inline', 'media', 'transitions']);

function emptyUiAttachments() {
  return {
    replies: [],
    buttons: [],
    inline: [],
    media: [],
    transitions: [],
  };
}

export function canRenderUi(blockType) {
  return RENDER_UI_ACTION_TYPES.has(String(blockType || '').trim());
}

export function getAllowedCapabilities(blockType) {
  return canRenderUi(blockType) ? ['buttons', 'inline', 'media'] : [];
}

export function canAttach(feature, blockType) {
  const requested = String(feature || '').trim();
  if (!requested || !canRenderUi(blockType)) return false;
  return getAllowedCapabilities(blockType).includes(requested);
}

export function normalizeUiAttachments(value) {
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = emptyUiAttachments();
  for (const group of UI_ATTACHMENT_GROUPS) {
    normalized[group] = Array.isArray(src[group]) ? src[group] : [];
  }
  return normalized;
}

export function validateBlockAttachments(block) {
  if (!block || typeof block !== 'object') return block;
  const normalized = normalizeUiAttachments(block.uiAttachments);
  const allowed = emptyUiAttachments();
  for (const group of UI_ATTACHMENT_GROUPS) {
    if (canAttach(group, block.type)) allowed[group] = normalized[group];
  }
  return { ...block, uiAttachments: allowed };
}
import { getBlockDefinition } from './blockRegistry.js';

export const UI_ATTACHMENT_GROUPS = Object.freeze(['replies', 'buttons', 'inline', 'media', 'transitions']);

const ATTACHMENT_FEATURE_BY_GROUP = Object.freeze({
  replies: 'replies',
  buttons: 'buttons',
  inline: 'inline',
  media: 'media',
  transitions: 'transitions',
});

function emptyUiAttachments() {
  return {
    replies: [],
    buttons: [],
    inline: [],
    media: [],
    transitions: [],
  };
}

export function canRenderUi(blockType) {
  return getBlockDefinition(blockType)?.uiScope === 'render';
}

export function getAllowedCapabilities(blockType) {
  return [...(getBlockDefinition(blockType)?.capabilities || [])];
}

export function canAttach(feature, blockType) {
  const requested = String(feature || '').trim();
  if (!requested || !canRenderUi(blockType)) return false;
  return getAllowedCapabilities(blockType).includes(requested);
}

export function normalizeUiAttachments(value) {
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = emptyUiAttachments();
  for (const group of UI_ATTACHMENT_GROUPS) {
    normalized[group] = Array.isArray(src[group]) ? src[group] : [];
  }
  return normalized;
}

export function validateBlockAttachments(block) {
  if (!block || typeof block !== 'object') return block;

  const normalized = normalizeUiAttachments(block.uiAttachments);
  const allowed = emptyUiAttachments();

  for (const group of UI_ATTACHMENT_GROUPS) {
    const feature = ATTACHMENT_FEATURE_BY_GROUP[group];
    if (canAttach(feature, block.type)) {
      allowed[group] = normalized[group];
    }
  }

  return {
    ...block,
    uiAttachments: allowed,
  };
}
