/**
 * A one-number vCard the way WhatsApp likes it. The `waid` parameter is what
 * makes the card tappable (call, save, open chat); without it the number is
 * plain text inside a card. vCard is line-delimited, so a name cannot carry a
 * newline; anything else in it is fine, WhatsApp shows it verbatim.
 */
export function contactVcard(contact: {
  name: string | null | undefined;
  phoneNumber: string;
}): { name: string; digits: string; vcard: string } {
  const digits = contact.phoneNumber.replace(/[^0-9]/g, '');
  const name =
    (contact.name ?? '').replace(/[\r\n]+/g, ' ').trim() || `+${digits}`;
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${name}`,
    `TEL;type=CELL;type=VOICE;waid=${digits}:+${digits}`,
    'END:VCARD',
  ].join('\n');
  return { name, digits, vcard };
}
