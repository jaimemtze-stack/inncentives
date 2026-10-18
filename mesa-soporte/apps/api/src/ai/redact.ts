import { redactText } from '../privacy/sensitive';

/**
 * Text sent to an AI provider: the payroll detector of section 5.7 (RFC,
 * CURP, NSS, CLABE, cards, salaries) plus e-mail addresses and phone-like
 * digit runs. Returns the text and how many replacements were made.
 */
export function redactForAi(text: string): { text: string; redactions: number } {
  let count = 0;
  const mark = (marker: string) => () => {
    count++;
    return marker;
  };
  let out = redactText(text);
  count += (out.match(/\[REDACTADO\]/g) ?? []).length;
  // Over-redaction is acceptable here: identifiers are matched by shape, without check digits.
  out = out
    .replace(/\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/gi, mark('[REDACTADO]'))
    .replace(/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/gi, mark('[REDACTADO]'))
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, mark('[CORREO]'))
    .replace(/\+?\d[\d\s().-]{8,}\d/g, mark('[NÚMERO]'))
    .replace(/\d{11,}/g, mark('[NÚMERO]'));
  return { text: out, redactions: count };
}
