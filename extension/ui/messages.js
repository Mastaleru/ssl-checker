// Human-readable texts for error codes, shared by the popup and the options page.
import { t } from '../lib/i18n.js';

const LOCAL_ERRORS = new Set([
  'restrictedPage',
  'blockedByPolicy',
  'probeBlocked',
  'reloadFailed',
  'canceledByUser',
  'detached',
  'navigated',
  'noCertificate',
  'notHttps',
  'tabGone',
  'alreadyAttached',
]);

export function localErrorText(local) {
  if (LOCAL_ERRORS.has(local.reason)) {
    return t(`localErr_${local.reason}`);
  }
  return t('localErr_generic', [local.detail || local.reason || '?']);
}

const NOTARY_ERRORS = new Set([
  'network',
  'unauthorized',
  'rateLimited',
  'badResponse',
  'badCertificate',
  'badEndpoint',
  'forbiddenTarget',
  'forbiddenPort',
  'dnsFailed',
  'connectFailed',
  'tlsFailed',
  'busy',
  'badRequest',
  'forbiddenOrigin',
]);

export function notaryErrorText(notary) {
  const e = notary.error || {};
  if (e.code === 'timeout') {
    return t('notaryErr_timeout', [Math.max(1, Math.round((notary.durationMs || 0) / 1000))]);
  }
  if (e.code === 'http') {
    return t('notaryErr_http', [e.status || '?']);
  }
  if (NOTARY_ERRORS.has(e.code)) {
    return t(`notaryErr_${e.code}`);
  }
  return t('notaryErr_other', [e.code || '?', e.message || e.status || '']);
}
