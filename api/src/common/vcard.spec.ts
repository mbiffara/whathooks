import { contactVcard } from './vcard';

describe('contactVcard', () => {
  it('builds a tappable WhatsApp card (waid + international number)', () => {
    const { name, digits, vcard } = contactVcard({
      name: 'Dalia Alejandra ',
      phoneNumber: '525639579170',
    });
    expect(name).toBe('Dalia Alejandra');
    expect(digits).toBe('525639579170');
    expect(vcard.split('\n')).toEqual([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Dalia Alejandra',
      'TEL;type=CELL;type=VOICE;waid=525639579170:+525639579170',
      'END:VCARD',
    ]);
  });

  it('strips formatting from the number and newlines from the name', () => {
    const { name, vcard } = contactVcard({
      name: 'Dalia\nAlejandra',
      phoneNumber: '+52 56 3957 9170',
    });
    expect(name).toBe('Dalia Alejandra');
    expect(vcard).toContain('waid=525639579170:+525639579170');
  });

  it('falls back to the number when the lead has no name', () => {
    expect(contactVcard({ name: null, phoneNumber: '525639579170' }).name).toBe(
      '+525639579170',
    );
  });
});
