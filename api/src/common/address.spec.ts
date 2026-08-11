import {
  addressIdentity,
  addressLabel,
  instagramAddress,
  instagramConversationId,
  isGroupAddress,
  isInstagramAddress,
  whatsappIdentity,
} from './address';

const DM = '5491122334455@s.whatsapp.net';
const LID = '188889999@lid';
const GROUP = '120363000000000000@g.us';
const IG = instagramAddress('68f1c2a4b9d3e75a1c204d8b');

describe('isGroupAddress', () => {
  it('is true only for WhatsApp group jids', () => {
    expect(isGroupAddress(GROUP)).toBe(true);
    expect(isGroupAddress(DM)).toBe(false);
    expect(isGroupAddress(LID)).toBe(false);
  });

  it('is false for channels that have no groups', () => {
    // Instagram gives a business account no way to create a multi-party
    // thread, so nothing on that channel may ever take the group code path.
    expect(isGroupAddress(IG)).toBe(false);
  });
});

describe('instagram addresses', () => {
  it('round-trips the provider id', () => {
    expect(isInstagramAddress(IG)).toBe(true);
    expect(instagramConversationId(IG)).toBe('68f1c2a4b9d3e75a1c204d8b');
  });

  it('does not mistake a whatsapp jid for one', () => {
    expect(isInstagramAddress(DM)).toBe(false);
    expect(instagramConversationId(DM)).toBeNull();
  });
});

describe('addressIdentity', () => {
  it('returns the user part of a whatsapp jid', () => {
    expect(addressIdentity(DM)).toBe('5491122334455');
    expect(addressIdentity(LID)).toBe('188889999');
    expect(addressIdentity(GROUP)).toBe('120363000000000000');
  });

  it('returns null rather than leaking an opaque provider id', () => {
    // This is the whole point of the scheme prefix: the inbox renders this
    // value as the contact's number, and a Zernio conversation id shown in
    // that slot would read as a real identifier to the customer.
    expect(addressIdentity(IG)).toBeNull();
  });
});

describe('whatsappIdentity', () => {
  it('reads a plain number off a phone jid', () => {
    expect(whatsappIdentity(DM)).toEqual({
      lid: null,
      phoneNumber: '5491122334455',
    });
  });

  it('keeps both identities when the number is hidden behind a LID', () => {
    expect(whatsappIdentity(LID, '5491122334455')).toEqual({
      lid: '188889999',
      phoneNumber: '5491122334455',
    });
  });

  it('yields a LID with no number when the hint is missing', () => {
    expect(whatsappIdentity(LID)).toEqual({
      lid: '188889999',
      phoneNumber: null,
    });
  });

  it('refuses non-whatsapp addresses so contacts are not saved wrongly', () => {
    expect(whatsappIdentity(IG)).toBeNull();
  });
});

describe('addressLabel', () => {
  it('prefers a cached name', () => {
    expect(addressLabel(DM, 'Ana')).toBe('Ana');
    expect(addressLabel(IG, 'ana.makes.cakes')).toBe('ana.makes.cakes');
  });

  it('falls back to a dialable number on whatsapp', () => {
    expect(addressLabel(DM)).toBe('+5491122334455');
    expect(addressLabel(DM, null)).toBe('+5491122334455');
  });

  it('never prefixes a non-number with +', () => {
    expect(addressLabel(IG)).toBe(IG);
    expect(addressLabel('', null)).toBe('');
  });
});
