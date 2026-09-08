import { normalizePhone, planImport } from './contacts-import';

describe('normalizePhone', () => {
  it('keeps digits with the country code', () => {
    expect(normalizePhone('+52 56 1058 8729')).toBe('525610588729');
    expect(normalizePhone('(55) 3445-3329')).toBe('5534453329');
    expect(normalizePhone('525610588729')).toBe('525610588729');
  });

  it('accepts a number Excel stored as a float', () => {
    expect(normalizePhone(525610588729)).toBe('525610588729');
  });

  it('rejects what cannot be a phone number', () => {
    expect(normalizePhone('1234')).toBeNull();
    expect(normalizePhone('1'.repeat(21))).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('sin número')).toBeNull();
  });
});

describe('planImport', () => {
  const agents = new Set(['ha_antonio', 'ha_alberto']);

  it('creates unknown numbers with whatever the row provides', () => {
    const plan = planImport(
      [
        {
          phoneNumber: '+52 56 1058 8729',
          name: ' Paris ',
          humanAgentId: 'ha_antonio',
        },
        { phoneNumber: '5299815294300' },
      ],
      [],
      agents,
    );
    expect(plan.toCreate).toEqual([
      {
        phoneNumber: '525610588729',
        name: 'Paris',
        humanAgentId: 'ha_antonio',
      },
      { phoneNumber: '5299815294300', name: null, humanAgentId: null },
    ]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it('lets the first occurrence of a number win', () => {
    const plan = planImport(
      [
        { phoneNumber: '525610588729', humanAgentId: 'ha_antonio' },
        { phoneNumber: '+52 (56) 1058-8729', humanAgentId: 'ha_alberto' },
      ],
      [],
      agents,
    );
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].humanAgentId).toBe('ha_antonio');
    expect(plan.skipped).toEqual([{ row: 1, reason: 'duplicate_in_batch' }]);
  });

  it('reports bad numbers and agents the org does not own', () => {
    const plan = planImport(
      [
        { phoneNumber: '12', name: 'X' },
        { phoneNumber: '525610588729', humanAgentId: 'ha_nobody' },
      ],
      [],
      agents,
    );
    expect(plan.toCreate).toEqual([]);
    expect(plan.skipped).toEqual([
      { row: 0, reason: 'invalid_phone' },
      { row: 1, reason: 'unknown_agent' },
    ]);
  });

  it('updates only what differs on an existing contact', () => {
    const existing = [
      {
        id: 'c1',
        phoneNumber: '525610588729',
        name: 'Paris',
        humanAgentId: 'ha_antonio',
      },
      {
        id: 'c2',
        phoneNumber: '5255344533290',
        name: null,
        humanAgentId: null,
      },
    ];
    const plan = planImport(
      [
        // Same as stored: nothing to do.
        {
          phoneNumber: '525610588729',
          name: 'Paris',
          humanAgentId: 'ha_antonio',
        },
        // New agent and a name for a contact that had none.
        {
          phoneNumber: '5255344533290',
          name: 'Nahum',
          humanAgentId: 'ha_alberto',
        },
      ],
      existing,
      agents,
    );
    expect(plan.unchanged).toBe(1);
    expect(plan.toUpdate).toEqual([
      { id: 'c2', data: { name: 'Nahum', humanAgentId: 'ha_alberto' } },
    ]);
  });

  it('never blanks a name, but does clear an agent when the row has none', () => {
    const plan = planImport(
      [{ phoneNumber: '525610588729' }],
      [
        {
          id: 'c1',
          phoneNumber: '525610588729',
          name: 'Paris',
          humanAgentId: 'ha_antonio',
        },
      ],
      agents,
    );
    expect(plan.toUpdate).toEqual([{ id: 'c1', data: { humanAgentId: null } }]);
  });
});
