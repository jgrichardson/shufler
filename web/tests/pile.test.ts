import { describe, expect, it } from 'vitest';
import { pileRows } from '../src/ui/panel/PilePanel';
import { PILE_ALL } from '../src/store/reducer';
import type { Shipped, Workpiece } from '../src/types';

const ship = (pr: number, domain: string, merged_at: string, extra: Partial<Shipped> = {}): Shipped => ({ pr, title: `t${pr}`, merged_at, deployed: true, domain, ...extra });
const wp = (pr: number, url: string, extra: Partial<Workpiece> = {}) => ({ id: `pr:${pr}`, pr, url, ...extra }) as Workpiece;

describe('pileRows', () => {
  const shipped = [
    ship(10, 'auth', '2026-10-20T10:00:00Z'),
    ship(12, 'auth', '2026-10-22T10:00:00Z', { closeout_owed: true }),
    ship(11, 'billing', '2026-10-21T10:00:00Z'),
  ];
  const workpieces = [wp(12, 'https://github.com/acme/app/pull/12', { shipped_via: 9 }), wp(99, 'https://github.com/acme/app/pull/99')];

  it('lists one domain newest first', () => {
    expect(pileRows({ shipped, workpieces }, 'auth').map((r) => r.pr)).toEqual([12, 10]);
  });

  it('lists every domain for the whole dock', () => {
    expect(pileRows({ shipped, workpieces }, PILE_ALL).map((r) => r.pr)).toEqual([12, 11, 10]);
  });

  it('carries shipped_via, the workpiece to select, and a GitHub link', () => {
    const [top, older] = pileRows({ shipped, workpieces }, 'auth');
    expect(top).toMatchObject({ via: 9, itemId: 'pr:12', href: 'https://github.com/acme/app/pull/12', closeout_owed: true });
    // no workpiece of its own: link built from the repo of another PR, nothing to select
    expect(older).toMatchObject({ via: null, itemId: null, href: 'https://github.com/acme/app/pull/10' });
  });

  it('leaves the number as plain text when no PR URL is known', () => {
    expect(pileRows({ shipped, workpieces: [] }, 'billing')[0].href).toBeNull();
  });
});
