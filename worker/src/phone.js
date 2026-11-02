export function normalizePhoneNumber(value) {
  if (typeof value !== 'string') throw new TypeError('Phone number must be a string');
  const phone = value.trim();
  if (!/^\d{8,15}$/.test(phone)) {
    throw new Error('Use 8–15 digits, including your country code, without +, spaces, or punctuation.');
  }
  return phone;
}
