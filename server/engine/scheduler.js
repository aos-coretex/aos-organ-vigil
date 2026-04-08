/**
 * Internal scheduler for Vigil test execution.
 * Runs test groups on schedule intervals defined in the CV registry.
 * Default: disabled (monolith CV runner handles production scheduling).
 * Enable with VIGIL_SCHEDULER_ENABLED=true.
 */

function log(event, data = {}) {
  const entry = { timestamp: new Date().toISOString(), event, ...data };
  process.stdout.write(JSON.stringify(entry) + '\n');
}

const SCHEDULE_INTERVALS = {
  '6h':    6 * 60 * 60 * 1000,
  'daily': 24 * 60 * 60 * 1000,
  'weekly': 7 * 24 * 60 * 60 * 1000,
};

const timers = [];

/**
 * Start scheduled test runs based on registry schedule fields.
 * @param {Array<object>} registry
 * @param {{ run: Function }} runner
 */
export function startScheduler(registry, runner) {
  for (const [schedule, intervalMs] of Object.entries(SCHEDULE_INTERVALS)) {
    const testsForSchedule = registry.filter((t) => t.schedule === schedule);
    if (testsForSchedule.length === 0) continue;

    const timer = setInterval(async () => {
      log('scheduler_tick', { schedule, tests: testsForSchedule.length });
      try {
        await runner.run({
          scope: 'all',
          triggered_by: 'scheduled',
        });
      } catch (err) {
        log('scheduler_error', { schedule, error: err.message });
      }
    }, intervalMs);

    // Don't hold the process open
    timer.unref();
    timers.push(timer);

    log('scheduler_registered', { schedule, interval_ms: intervalMs, tests: testsForSchedule.length });
  }
}

/**
 * Stop all scheduled timers.
 */
export function stopScheduler() {
  for (const timer of timers) {
    clearInterval(timer);
  }
  timers.length = 0;
}
