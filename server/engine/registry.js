/**
 * CV Registry parser — loads the YAML registry and builds an indexed test catalog.
 * Uses python3 yaml.safe_load for YAML parsing (matches monolith CV runner pattern).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Parse CV registry YAML into a test array.
 * @param {string} registryPath - Absolute path to continuous-verification-registry.yaml
 * @returns {Array<object>} - Array of test definitions
 */
export function loadRegistry(registryPath) {
  const yaml = readFileSync(registryPath, 'utf-8');

  const json = execFileSync('python3', [
    '-c',
    'import yaml, json, sys; print(json.dumps(yaml.safe_load(sys.stdin.read())))',
  ], {
    input: yaml,
    encoding: 'utf-8',
    timeout: 10000,
  });

  const tests = JSON.parse(json.trim());

  if (!Array.isArray(tests)) {
    throw new Error('CV registry did not parse to an array');
  }

  return tests;
}

/**
 * Build a lookup index from the registry keyed by test id.
 * @param {Array<object>} registry
 * @returns {Map<string, object>}
 */
export function indexById(registry) {
  const map = new Map();
  for (const test of registry) {
    if (test.id) {
      map.set(test.id, test);
    }
  }
  return map;
}

/**
 * Filter registry by group, tier, or schedule.
 * @param {Array<object>} registry
 * @param {object} filters - { group?, tier?, schedule? }
 * @returns {Array<object>}
 */
export function filterRegistry(registry, { group, tier, schedule } = {}) {
  let result = registry;
  if (group) result = result.filter((t) => t.group === group);
  if (tier) result = result.filter((t) => t.tier === tier);
  if (schedule) result = result.filter((t) => t.schedule === schedule);
  return result;
}

/**
 * Extract all unique deterministic trigger event names from the registry.
 * @param {Array<object>} registry
 * @returns {string[]}
 */
export function extractTriggerEvents(registry) {
  const events = new Set();
  for (const test of registry) {
    if (Array.isArray(test.deterministic)) {
      for (const trigger of test.deterministic) {
        if (trigger.event) {
          events.add(trigger.event);
        }
      }
    }
  }
  return [...events];
}

/**
 * Get tests that should fire for a given deterministic event.
 * @param {Array<object>} registry
 * @param {string} eventType
 * @returns {Array<object>}
 */
export function getTestsForEvent(registry, eventType) {
  return registry.filter((test) =>
    Array.isArray(test.deterministic) &&
    test.deterministic.some((d) => d.event === eventType)
  );
}
