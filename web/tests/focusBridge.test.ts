import { describe, expect, it, vi } from 'vitest';
import { bridgeFocus, focusBridgeBase } from '../src/api/focusBridge';

const ORIGIN = 'http://127.0.0.1:4793';

describe('focusBridgeBase', () => {
  it('is on only in a dev build with ?mock=1 and a focusbridge base', () => {
    expect(focusBridgeBase('?mock=1&focusbridge=/hero-daemon', ORIGIN, true)).toBe('http://127.0.0.1:4793/hero-daemon');
    expect(focusBridgeBase('?mock=1&focusbridge=http://127.0.0.1:4795/', ORIGIN, true)).toBe('http://127.0.0.1:4795');
    expect(focusBridgeBase('?mock=1&focusbridge=/hero-daemon', ORIGIN, false)).toBeNull();
    expect(focusBridgeBase('?focusbridge=/hero-daemon', ORIGIN, true)).toBeNull();
    expect(focusBridgeBase('?mock=1', ORIGIN, true)).toBeNull();
  });

  it('refuses the real daemon port and non-loopback hosts', () => {
    expect(focusBridgeBase('?mock=1&focusbridge=http://127.0.0.1:4700', ORIGIN, true)).toBeNull();
    expect(focusBridgeBase('?mock=1&focusbridge=/x', 'http://localhost:4700', true)).toBeNull();
    expect(focusBridgeBase('?mock=1&focusbridge=http://example.com:4795', ORIGIN, true)).toBeNull();
  });
});

describe('bridgeFocus', () => {
  const snapshot = { stations: [{ id: '@1', title: 'AUTH' }, { id: '@3', title: 'BILLING' }] };
  const fakeFetch = () =>
    vi.fn(async (url: string, _init?: RequestInit) => new Response(url.endsWith('/api/snapshot') ? JSON.stringify(snapshot) : '{"ok":true}'));

  it('maps the mock row title to the bridged station and posts one focus action', async () => {
    const f = fakeFetch();
    expect(await bridgeFocus('http://127.0.0.1:4795', 'BILLING', f as unknown as typeof fetch)).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    const [url, init] = f.mock.calls[1];
    expect(url).toBe('http://127.0.0.1:4795/api/actions');
    expect(JSON.parse(String(init?.body))).toEqual({ action: 'focus', params: { station_id: '@3' } });
  });

  it('posts nothing when no bridged station has that title', async () => {
    const f = fakeFetch();
    expect(await bridgeFocus('http://127.0.0.1:4795', 'Release notes', f as unknown as typeof fetch)).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
