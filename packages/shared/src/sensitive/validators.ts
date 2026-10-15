/** Check-digit validators for Mexican identifiers and payment numbers. */

export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

const CURP_DICT = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';

/** CURP check digit (position 18) per RENAPO. */
export function curpValid(curp: string): boolean {
  const c = curp.toUpperCase();
  if (!/^[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/.test(c))
    return false;
  if (!plausibleYYMMDD(c.slice(4, 10))) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const v = CURP_DICT.indexOf(c.charAt(i));
    if (v < 0) return false;
    sum += v * (18 - i);
  }
  const digit = (10 - (sum % 10)) % 10;
  return digit === Number(c.charAt(17));
}

/** CLABE: 18 digits, weights 3-7-1, check digit at position 18. */
export function clabeValid(clabe: string): boolean {
  if (!/^\d{18}$/.test(clabe)) return false;
  const weights = [3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += ((clabe.charCodeAt(i) - 48) * weights[i % 3]!) % 10;
  return (10 - (sum % 10)) % 10 === clabe.charCodeAt(17) - 48;
}

/** IMSS NSS: 11 digits, last one is a Luhn check digit over the first 10. */
export function nssValid(nss: string): boolean {
  return /^\d{11}$/.test(nss) && luhnValid(nss);
}

/** RFC (persona física 13 / moral 12): structure plus plausible date. */
export function rfcValid(rfc: string): boolean {
  const r = rfc.toUpperCase();
  const m = /^([A-ZÑ&]{3,4})(\d{6})([A-Z\d]{2}[A\d])$/.exec(r);
  if (!m) return false;
  return plausibleYYMMDD(m[2]!);
}

export function plausibleYYMMDD(s: string): boolean {
  const month = Number(s.slice(2, 4));
  const day = Number(s.slice(4, 6));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}
