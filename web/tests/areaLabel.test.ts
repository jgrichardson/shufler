import { describe, expect, it } from 'vitest';
import { areaLabel, domainDef } from '../src/lib/domains';

describe('areaLabel', () => {
  it('uses the domain label for a known domain and title-cases other areas', () => {
    expect(areaLabel('auth')).toBe(domainDef('auth').label);
    expect(areaLabel('data_platform')).toBe('Data Platform');
    expect(areaLabel('some_area')).toBe('Some Area');
  });
});
