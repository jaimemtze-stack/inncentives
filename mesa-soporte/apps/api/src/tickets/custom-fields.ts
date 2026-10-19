import type { ObjectAttribute } from '@prisma/client';
import { AppError } from '../common/errors';

type Value = string | number | boolean | string[] | null;

interface Option {
  value: string;
}

function invalid(name: string): never {
  throw new AppError('validation_failed', 'Invalid custom field.', [
    { path: `customFields.${name}`, code: 'invalid' },
  ]);
}

function check(attr: ObjectAttribute, v: Value): Value {
  if (v === null || v === '') return null;
  const options = new Set(((attr.options ?? []) as unknown as Option[]).map((o) => o.value));
  switch (attr.dataType) {
    case 'text':
      if (typeof v !== 'string' || v.length > 500) invalid(attr.name);
      return v.trim();
    case 'textarea':
      if (typeof v !== 'string' || v.length > 2000) invalid(attr.name);
      return v;
    case 'select':
      if (typeof v !== 'string' || !options.has(v)) invalid(attr.name);
      return v;
    case 'multiselect':
      if (!Array.isArray(v) || v.some((x) => !options.has(x))) invalid(attr.name);
      return [...new Set(v)];
    case 'boolean':
      if (typeof v !== 'boolean') invalid(attr.name);
      return v;
    case 'integer':
      if (typeof v !== 'number' || !Number.isSafeInteger(v)) invalid(attr.name);
      return v;
    case 'date':
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))
        invalid(attr.name);
      return v;
    default:
      return invalid(attr.name);
  }
}

/**
 * Validates custom field values against the active attribute definitions.
 * Unknown keys are rejected; customers may only touch attributes marked as
 * editable by customers. Returns the merged values to store.
 */
export function applyCustomFields(
  attrs: ObjectAttribute[],
  current: Record<string, unknown>,
  input: Record<string, Value> | undefined,
  mode: { customer: boolean; creating: boolean },
): Record<string, unknown> {
  const byName = new Map(attrs.filter((a) => a.active).map((a) => [a.name, a]));
  const out: Record<string, unknown> = { ...current };
  for (const [name, value] of Object.entries(input ?? {})) {
    const attr = byName.get(name);
    if (!attr || (mode.customer && !attr.editableByCustomer)) invalid(name);
    const v = check(attr, value);
    if (v === null) delete out[name];
    else out[name] = v;
  }
  if (mode.creating) {
    for (const attr of byName.values()) {
      const applies = mode.customer ? attr.editableByCustomer : true;
      if (attr.required && applies && (out[attr.name] === undefined || out[attr.name] === null)) {
        throw new AppError('validation_failed', 'Missing required field.', [
          { path: `customFields.${attr.name}`, code: 'required' },
        ]);
      }
    }
  }
  return out;
}

/** Custom fields a customer may see. */
export function customerVisibleFields(attrs: ObjectAttribute[], values: Record<string, unknown>) {
  const visible = new Set(attrs.filter((a) => a.active && a.visibleToCustomer).map((a) => a.name));
  return Object.fromEntries(Object.entries(values).filter(([k]) => visible.has(k)));
}
