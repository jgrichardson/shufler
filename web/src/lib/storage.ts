import { STORAGE_PREFIX } from './brand';

/** Browser storage keys are STORAGE_PREFIX + name. */
export const storageKey = (name: string) => STORAGE_PREFIX + name;

/** localStorage.getItem for a storage key. Throws like getItem when storage is unavailable. */
export function getStored(key: string): string | null {
  return localStorage.getItem(key);
}
