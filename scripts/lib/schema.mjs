import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deliberately bounded JSON Schema evaluator. Unsupported assertions fail closed.
// The repository uses only these keywords; it is not a general-purpose validator.
const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../../.agent/schemas');
const cache = new Map();
const keywords = new Set(['$schema', '$id', '$defs', '$ref', 'title', 'description', 'type', 'const', 'enum', 'allOf', 'anyOf', 'oneOf', 'required', 'properties', 'additionalProperties', 'items', 'minItems', 'uniqueItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'format']);
function schema(name) {
  if (!/^[a-z-]+\.schema\.json$/.test(name)) throw new Error('Invalid schema reference');
  if (!cache.has(name)) {
    const path = resolve(directory, name);
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || realpathSync(path).toLowerCase() !== path.toLowerCase()) throw new Error('Unsafe schema file');
    cache.set(name, JSON.parse(readFileSync(path, 'utf8')));
  }
  return cache.get(name);
}
function fail(path, reason) { throw new Error(`Schema ${path}: ${reason}`); }
function validate(value, rule, document, path) {
  for (const key of Object.keys(rule)) if (!keywords.has(key)) fail(path, `unsupported keyword ${key}`);
  if (rule.$ref) {
    const [file, pointer = ''] = rule.$ref.split('#');
    const targetDocument = file ? schema(file) : document;
    let target = targetDocument;
    if (pointer && !pointer.startsWith('/')) fail(path, 'invalid schema pointer');
    for (const key of pointer.split('/').slice(1)) target = target?.[key.replaceAll('~1', '/').replaceAll('~0', '~')];
    if (!target) fail(path, 'missing schema reference');
    validate(value, target, targetDocument, path);
  }
  for (const sub of rule.allOf ?? []) validate(value, sub, document, path);
  for (const key of ['anyOf', 'oneOf']) if (rule[key]) {
    let valid = 0;
    for (const sub of rule[key]) { try { validate(value, sub, document, path); valid++; } catch {} }
    if ((key === 'oneOf' && valid !== 1) || (key === 'anyOf' && valid === 0)) fail(path, `no valid ${key} branch`);
  }
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (rule.type) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.some(t => t === type || (t === 'integer' && typeof value === 'number' && Number.isSafeInteger(value)))) fail(path, `expected ${types.join('|')}`);
  }
  if (Object.hasOwn(rule, 'const') && JSON.stringify(value) !== JSON.stringify(rule.const)) fail(path, 'constant mismatch');
  if (rule.enum && !rule.enum.some(v => JSON.stringify(v) === JSON.stringify(value))) fail(path, 'invalid enum');
  if (typeof value === 'string') {
    if (rule.minLength !== undefined && value.length < rule.minLength) fail(path, 'too short');
    if (rule.maxLength !== undefined && value.length > rule.maxLength) fail(path, 'too long');
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) fail(path, 'invalid pattern');
    if (rule.format === 'date-time') {
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail(path, 'invalid timestamp');
      const normalized = value.includes('.') ? value.replace(/\.(\d{1,3})Z$/, (_, fraction) => '.' + fraction.padEnd(3, '0') + 'Z') : value.replace('Z', '.000Z');
      if (new Date(value).toISOString() !== normalized) fail(path, 'invalid calendar timestamp');
    }
    if (rule.format && rule.format !== 'date-time') fail(path, 'unsupported format');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (rule.minimum !== undefined && value < rule.minimum) || (rule.maximum !== undefined && value > rule.maximum)) fail(path, 'number out of range');
  }
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) fail(path, 'too few items');
    if (rule.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) fail(path, 'duplicate items');
    if (rule.items) value.forEach((v, i) => validate(v, rule.items, document, `${path}[${i}]`));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) fail(path, `missing ${key}`);
    for (const [key, v] of Object.entries(value)) {
      if (rule.properties?.[key]) validate(v, rule.properties[key], document, `${path}.${key}`);
      else if (rule.additionalProperties === false) fail(path, `unexpected ${key}`);
      else if (typeof rule.additionalProperties === 'object') validate(v, rule.additionalProperties, document, `${path}.${key}`);
    }
  }
}
export function validateSchema(value, name) { const rule = schema(name); validate(value, rule, rule, '$'); return value; }
