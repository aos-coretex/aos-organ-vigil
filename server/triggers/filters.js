/**
 * Spine broadcast subscription filters built from CV registry deterministic triggers.
 *
 * Vigil subscribes to all event types that appear as deterministic triggers in the
 * CV registry. When a matching broadcast arrives, the associated tests fire.
 */

import { extractTriggerEvents, getTestsForEvent } from '../engine/registry.js';

function log(event, data = {}) {
  const entry = { timestamp: new Date().toISOString(), event, ...data };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

/**
 * Build WebSocket subscription filter objects from the registry.
 * Each unique deterministic trigger event becomes a subscription filter.
 * @param {Array<object>} registry
 * @returns {Array<object>} - filters for Spine subscribe protocol
 */
export function buildTriggerFilters(registry) {
  const events = extractTriggerEvents(registry);
  return events.map((eventType) => ({
    event_type: eventType,
  }));
}

/**
 * Handle a broadcast event that matches a deterministic trigger.
 * Looks up which tests declare this event as a trigger and runs them.
 * @param {object} envelope - { event_type, payload }
 * @param {Array<object>} registry
 * @param {{ run, runTest }} runner
 */
export async function handleTriggerEvent(envelope, registry, runner) {
  const eventType = envelope.event_type || envelope.payload?.event_type;
  if (!eventType) return;

  const matchingTests = getTestsForEvent(registry, eventType);
  if (matchingTests.length === 0) return;

  const testIds = matchingTests.map((t) => t.id);
  log('trigger_event_received', { event_type: eventType, tests: testIds });

  for (const id of testIds) {
    await runner.runTest(id, 'deterministic', envelope.id || eventType);
  }
}
