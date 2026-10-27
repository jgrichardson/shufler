import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME, parseConfig, parseDomains, parsePrompts } from '../src/api/config';
import { PROMPTS } from '../src/ui/prompts';

describe('GET /api/config', () => {
  it('turns flat daemon prompts into the library, #N becoming {pr}', () => {
    const p = parsePrompts(['CI is red on #N: fix it and push', 'Run /pr-pre-review on this PR'])!;
    expect(p[0]).toEqual({ group: 'CI is red', label: 'CI is red', text: 'CI is red on {pr}: fix it and push' });
    expect(p[1].label).toBe('Run /pr-pre-review on');
  });
  it('keeps grouped prompts as given', () => {
    expect(parsePrompts([{ group: 'Status', label: 'Status', text: 'Status of {pr}?' }])).toEqual([{ group: 'Status', label: 'Status', text: 'Status of {pr}?' }]);
  });
  it('falls back to the built-in defaults', () => {
    const c = parseConfig({});
    expect(c.product).toBe(PRODUCT_NAME);
    expect(c.prompts).toBe(PROMPTS);
  });
  it('takes the product name from the daemon', () => {
    expect(parseConfig({ product: 'Night Shift' }).product).toBe('Night Shift');
  });
  it('reads the domain palette', () => {
    expect(parseDomains([{ id: 'x', label: 'X', code: 'XX', color: '#123456', aliases: ['x'] }])).toEqual([{ id: 'x', label: 'X', code: 'XX', color: '#123456', aliases: ['x'] }]);
    expect(parseDomains('nope')).toBeNull();
  });
});
