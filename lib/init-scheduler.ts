import { initScheduler } from './scheduler';

// This file is intended to be imported once in a top-level module (like lib/mysql.ts)
// to ensure the scheduler starts when the application starts.
//
// Deferred via setImmediate, not called directly: this file is imported by
// lib/mysql.ts BEFORE that file finishes assigning its own `pool` variable
// (static imports run before the rest of the importing module's top-level
// code, regardless of where the import line sits in the file). scheduler.ts
// queries the database as soon as it starts (e.g. the hourly catch-up sweep
// on init), so calling initScheduler() synchronously here hits `pool` in its
// temporal dead zone. setImmediate pushes the call to the next event-loop
// tick, after mysql.ts's module body — including the pool assignment — has
// finished running.
setImmediate(() => {
  initScheduler();
});
