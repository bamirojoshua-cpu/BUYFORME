/**
 * BuyForMe — Form validators
 */

/** @param {unknown} value */
export function required(value) {
  const v = typeof value === "string" ? value.trim() : value;
  return v !== null && v !== undefined && v !== "" ? null : "This field is required.";
}

/** @param {unknown} value */
export function isEmail(value) {
  if (!value) return null;
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
  return ok ? null : "Enter a valid email address.";
}

/**
 * @param {unknown} value
 * @param {number} min
 */
export function minLength(value, min) {
  if (!value) return null;
  return String(value).trim().length >= min
    ? null
    : `Must be at least ${min} characters.`;
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} [max=Infinity]
 */
export function numberRange(value, min, max = Infinity) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "Enter a valid number.";
  if (n < min) return `Must be at least ${min}.`;
  if (n > max) return `Must be no more than ${max}.`;
  return null;
}

/** @param {unknown} value */
export function isPhone(value) {
  if (!value) return null;
  const ok = /^[\d\s+\-()]{7,20}$/.test(String(value).trim());
  return ok ? null : "Enter a valid phone number.";
}

/**
 * Run validators and return first error message or null.
 * @param {unknown} value
 * @param {Array<(v: unknown) => string|null>} validators
 */
export function validate(value, validators) {
  for (const fn of validators) {
    const err = fn(value);
    if (err) return err;
  }
  return null;
}

/**
 * Validate a form object against a schema.
 * @param {Record<string, unknown>} values
 * @param {Record<string, Array<(v: unknown) => string|null>>} schema
 * @returns {Record<string, string>} field errors (empty if valid)
 */
export function validateForm(values, schema) {
  /** @type {Record<string, string>} */
  const errors = {};
  for (const [field, validators] of Object.entries(schema)) {
    const err = validate(values[field], validators);
    if (err) errors[field] = err;
  }
  return errors;
}
