import { API_URL, apiFetch } from './apiClient.js';

export const FALLBACK_PRO_MONTHLY_USD = 8;

export function formatUsdPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) return `$${FALLBACK_PRO_MONTHLY_USD}`;
  return `$${Number.isInteger(price) ? price : price.toFixed(2)}`;
}

export function getMonthlyProPriceUsd(plans) {
  const price = Number(plans?.['1m']?.usd);
  return Number.isFinite(price) && price > 0 ? price : FALLBACK_PRO_MONTHLY_USD;
}

export async function fetchPublicPlans() {
  const data = await apiFetch(`${API_URL}/plans`, { cache: 'no-store' });
  return data?.plans || {};
}
