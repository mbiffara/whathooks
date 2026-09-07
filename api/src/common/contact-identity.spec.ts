import { contactIdentityWhere } from './contact-identity';

describe('contactIdentityWhere', () => {
  it('matches a phone jid on the number', () => {
    expect(contactIdentityWhere('org1', '525610588729@s.whatsapp.net')).toEqual(
      { organizationId: 'org1', OR: [{ phoneNumber: '525610588729' }] },
    );
  });

  it('matches a LID on either the LID or the resolved number', () => {
    expect(
      contactIdentityWhere('org1', '210170298781707@lid', '525610588729'),
    ).toEqual({
      organizationId: 'org1',
      OR: [{ lid: '210170298781707' }, { phoneNumber: '525610588729' }],
    });
  });

  it('matches an unresolved LID on the LID alone', () => {
    expect(contactIdentityWhere('org1', '210170298781707@lid', null)).toEqual({
      organizationId: 'org1',
      OR: [{ lid: '210170298781707' }],
    });
  });

  it('has nothing to match for an Instagram address', () => {
    expect(contactIdentityWhere('org1', 'ig:abc123')).toBeNull();
  });
});
