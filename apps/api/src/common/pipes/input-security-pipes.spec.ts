import { NormalizeInputPipe } from './normalize-input.pipe';
import { SanitizeHtmlPipe } from './sanitize-html.pipe';

describe('input security pipes', () => {
  it('preserves password values exactly while normalizing ordinary text', () => {
    const password = '  pass < word  ';
    const result = new NormalizeInputPipe().transform({
      password,
      profile: { firstName: '  Jane  ' },
    }) as { password: string; profile: { firstName: string } };

    expect(result.password).toBe(password);
    expect(result.profile.firstName).toBe('Jane');
  });

  it('preserves credentials and strips markup from ordinary input', () => {
    const password = '<b>exact password</b>';
    const result = new SanitizeHtmlPipe().transform({
      password,
      description: '<script>alert(1)</script><b>safe text</b>',
    }) as { password: string; description: string };

    expect(result.password).toBe(password);
    expect(result.description).not.toContain('<script');
    expect(result.description).not.toContain('<b>');
  });

  it('keeps encoded tag-shaped text from becoming markup after decoding', () => {
    const result = new SanitizeHtmlPipe().transform({
      description: '&lt;img src=x onerror=alert(1)&gt;',
    }) as { description: string };

    expect(result.description).not.toContain('<img');
    expect(result.description).toContain('&lt;img');
  });
});
