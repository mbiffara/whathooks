import {
  applyPayloadMapping,
  formatDate,
  mappingRulesError,
} from './payload-mapping';

const envelope = {
  event: 'message.received',
  sessionId: 'sess_1',
  data: {
    id: 'msg_1',
    from: '15551234567',
    text: 'hello',
    timestamp: 1751212800, // 2025-06-29T16:00:00Z
    media: { mimeType: 'image/jpeg' },
  },
  timestamp: '2026-07-14T22:00:00.000Z',
};

describe('applyPayloadMapping', () => {
  it('renames fields via dot paths', () => {
    expect(
      applyPayloadMapping(
        [
          { target: 'phone', source: 'data.from' },
          { target: 'message', source: 'data.text' },
          { target: 'mime', source: 'data.media.mimeType' },
        ],
        envelope,
      ),
    ).toEqual({
      phone: '15551234567',
      message: 'hello',
      mime: 'image/jpeg',
    });
  });

  it('reaches envelope fields outside data', () => {
    expect(
      applyPayloadMapping([{ target: 'kind', source: 'event' }], envelope),
    ).toEqual({ kind: 'message.received' });
  });

  it('injects fixed values', () => {
    expect(
      applyPayloadMapping(
        [
          { target: 'origin', value: 'whathooks' },
          { target: 'version', value: 2 },
          { target: 'flag', value: false },
        ],
        envelope,
      ),
    ).toEqual({ origin: 'whathooks', version: 2, flag: false });
  });

  it('formats unix-second dates with a token pattern', () => {
    expect(
      applyPayloadMapping(
        [
          {
            target: 'receivedAt',
            source: 'data.timestamp',
            dateFormat: 'yyyy-MM-dd HH:mm:ss',
          },
        ],
        envelope,
      ),
    ).toEqual({ receivedAt: '2025-06-29 16:00:00' });
  });

  it('omits fields whose source is missing', () => {
    expect(
      applyPayloadMapping(
        [
          { target: 'gone', source: 'data.nope' },
          { target: 'kept', source: 'data.text' },
        ],
        envelope,
      ),
    ).toEqual({ kept: 'hello' });
  });
});

describe('formatDate', () => {
  it('supports presets', () => {
    expect(formatDate(1751212800, 'iso')).toBe('2025-06-29T16:00:00.000Z');
    expect(formatDate('2025-06-29T16:00:00.000Z', 'unix')).toBe(1751212800);
    expect(formatDate(1751212800, 'unix_ms')).toBe(1751212800000);
  });

  it('treats large numbers as milliseconds', () => {
    expect(formatDate(1751212800000, 'iso')).toBe('2025-06-29T16:00:00.000Z');
  });

  it('passes unparseable values through unchanged', () => {
    expect(formatDate('not a date', 'yyyy-MM-dd')).toBe('not a date');
    expect(formatDate({ nope: true }, 'iso')).toEqual({ nope: true });
  });
});

describe('mappingRulesError', () => {
  it('accepts a valid rule set', () => {
    expect(
      mappingRulesError([
        { target: 'phone', source: 'data.from' },
        { target: 'origin', value: 'x' },
      ]),
    ).toBeNull();
  });

  it('rejects a rule with both source and value', () => {
    expect(
      mappingRulesError([{ target: 'x', source: 'data.a', value: 'b' }]),
    ).toMatch(/exactly one/);
  });

  it('rejects a rule with neither source nor value', () => {
    expect(mappingRulesError([{ target: 'x' }])).toMatch(/exactly one/);
  });

  it('rejects duplicate targets and bad names', () => {
    expect(
      mappingRulesError([
        { target: 'a', source: 'data.x' },
        { target: 'a', source: 'data.y' },
      ]),
    ).toMatch(/Duplicate/);
    expect(mappingRulesError([{ target: '1bad', source: 'data.x' }])).toMatch(
      /Invalid target/,
    );
  });

  it('rejects dateFormat on fixed values', () => {
    expect(
      mappingRulesError([{ target: 'x', value: 'y', dateFormat: 'iso' }]),
    ).toMatch(/requires a source/);
  });
});
