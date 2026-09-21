// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useBuiltIdsPersistence } from '@/components/map/pubmap/useBuiltIdsPersistence';

const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
afterEach(() => { if (storageDescriptor) Object.defineProperty(window, 'localStorage', storageDescriptor); vi.restoreAllMocks(); });
function Probe({ ids }: { ids: string[] }) { useBuiltIdsPersistence(ids, 'audit-built'); return null; }
it.each([{ ids: [] }, { ids: ['venue-a'] }])('keeps the map mounted when storage access is denied: %j', async ({ ids }) => {
  Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Denied', 'SecurityError'); } });
  const root = createRoot(document.createElement('div'));
  try { await expect(act(async () => { root.render(createElement(Probe, { ids })); })).resolves.toBeUndefined(); }
  finally { await act(async () => root.unmount()); }
});
it('keeps in-memory stops when storage quota is exhausted', async () => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { setItem() { throw new DOMException('Full', 'QuotaExceededError'); } } });
  const root = createRoot(document.createElement('div'));
  try { await expect(act(async () => { root.render(createElement(Probe, { ids: ['venue-a'] })); })).resolves.toBeUndefined(); }
  finally { await act(async () => root.unmount()); }
});
