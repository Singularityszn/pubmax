// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MusicTonightLane from '@/components/discovery/MusicTonightLane';
import type { WhatsOnRow } from '@/lib/whatsOn';
const load = vi.hoisted(() => vi.fn());
vi.mock('@/lib/surfaceDataCache', () => ({ loadSurfaceJson: load }));
const now = Date.parse('2026-09-21T18:00:00Z');
function listing(kind: WhatsOnRow['kind']): WhatsOnRow { return { id: kind, kind, venueId: 'fixture', placeName: 'Fixture pub', title: `${kind} fixture`, startsAt: new Date(now - 3600000).toISOString(), endsAt: new Date(now + 60000).toISOString(), observedAt: new Date(now - 3600000).toISOString(), confidence: 'listed', source: { label: 'Official fixture', url: 'https://example.com/listing' } }; }
let root: Root; let host: HTMLDivElement;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); host = document.createElement('div'); root = createRoot(host); load.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });
it('renders valid self-fetched music instead of passing the array index as its clock', async () => {
 load.mockImplementation(async (_url, _options, receive) => { receive({ rows: [listing('music'), { broken: true }], asOf: new Date(now).toISOString() }); });
 await act(async () => root.render(createElement(MusicTonightLane)));
 expect(host.textContent).toContain('music fixture');
});
