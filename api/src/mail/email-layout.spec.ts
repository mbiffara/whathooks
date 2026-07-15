import { EmailContent, renderEmailHtml, renderEmailText } from './email-layout';

const content: EmailContent = {
  preheader: 'Preview line',
  heading: 'Reset your password',
  paragraphs: ['First paragraph.', 'Second <b>paragraph</b> & more.'],
  cta: {
    label: 'Choose a new password',
    url: 'https://app.test/reset?token=abc',
  },
  footnote: 'Valid for 1 hour.',
};

describe('renderEmailHtml', () => {
  it('includes heading, copy, CTA link, and footer credit', () => {
    const html = renderEmailHtml(content);
    expect(html).toContain('Reset your password');
    expect(html).toContain('First paragraph.');
    expect(html).toContain('https://app.test/reset?token=abc');
    expect(html).toContain('Choose a new password');
    expect(html).toContain('logicalminds');
    expect(html).toContain('Preview line');
  });

  it('escapes HTML in user-influenced content', () => {
    const html = renderEmailHtml(content);
    expect(html).toContain('Second &lt;b&gt;paragraph&lt;/b&gt; &amp; more.');
    expect(html).not.toContain('<b>paragraph</b>');
  });

  it('renders without a CTA or footnote', () => {
    const html = renderEmailHtml({
      preheader: 'p',
      heading: 'h',
      paragraphs: ['x'],
    });
    expect(html).toContain('<h1');
    expect(html).not.toContain('Or copy this link');
  });
});

describe('renderEmailText', () => {
  it('carries the same content including the raw URL', () => {
    const text = renderEmailText(content);
    expect(text).toContain('Reset your password');
    expect(text).toContain(
      'Choose a new password: https://app.test/reset?token=abc',
    );
    expect(text).toContain('Valid for 1 hour.');
    expect(text).toContain('powered by logicalminds');
  });
});
