import { describe, expect, it } from 'vitest';
import { domainLine, domainTarget } from '../src/ui/panel/DomainMove';
import { emptyWorkspaceLabel } from '../src/ui/panel/Telemetry';
import { itemLabel } from '../src/ui/panel/common';
import { CLEAN_LAYERS, DEFAULT_LAYERS, parseLayers } from '../src/ui/layers';
import { normalizeSnapshot } from '../src/lib/derive';

describe('round 3: empty workspaces and domain moves', () => {
  it('hides empty workspaces by default and keeps the toggle across reloads', () => {
    expect(DEFAULT_LAYERS.empty).toBe(false);
    expect(CLEAN_LAYERS.empty).toBe(false);
    expect(parseLayers(JSON.stringify({ empty: true })).empty).toBe(true);
  });

  it('lists an empty workspace by its group', () => {
    expect(emptyWorkspaceLabel({ group: 'ON_HOLD' })).toBe('Untitled workspace · ON_HOLD');
    expect(emptyWorkspaceLabel({ group: null })).toBe('Untitled workspace · ungrouped');
  });

  it('says which domain and why', () => {
    expect(domainLine('billing', 'PR scope `billing`')).toBe('domain: Billing (PR scope `billing`)');
    expect(domainLine('billing', null)).toBe('domain: Billing');
  });

  it('targets set_domain at a PR or a workspace', () => {
    expect(domainTarget({ pr: 305 })).toBe('pr:305');
    expect(domainTarget({ station: 'ws-a' })).toBe('station:ws-a');
  });
});

describe('round 5: pod labels never show a branch', () => {
  it('uses the PR number, else the title, else Untitled work', () => {
    expect(itemLabel({ pr: 7, id: 'pr:7', title: 'x' })).toBe('#7');
    expect(itemLabel({ pr: null, id: 'branch:gr_09-14_pre_cutover', title: 'pre-cutover amendments' })).toBe('pre-cutover a…');
    const s = normalizeSnapshot({ stations: [], workpieces: [{ id: 'branch:dev_x', branch: 'dev_x', title: null, label: 'Untitled work' }] }, { now: 1 });
    expect(s.workpieces[0].title).toBe('Untitled work');
    expect(itemLabel(s.workpieces[0])).toBe('Untitled work');
  });

  it('carries groups and stale ledger rows through', () => {
    const s = normalizeSnapshot(
      {
        stations: [{ id: 'a', title: 'A', sidebar_index: 3, anchor_for: 'GENERAL' }],
        workpieces: [],
        groups: [{ name: 'IN_PROGRESS', index: 1, pinned: true, member_count: 5 }],
        stale_ledger_rows: [{ ledger_path: '/x/ledger.md', area: 'maint', branch: 'gr_y', title: null }],
      },
      { now: 1 },
    );
    expect(s.stations[0]).toMatchObject({ sidebar_index: 3, anchor_for: 'GENERAL' });
    expect(s.groups).toEqual([{ name: 'IN_PROGRESS', index: 1, pinned: true, member_count: 5 }]);
    expect(s.stale_ledger_rows?.[0].branch).toBe('gr_y');
  });
});
