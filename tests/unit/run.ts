// Runs every unit test file. Each test self-executes its assertions on import
// and throws (non-zero exit) on failure.
import './sidebar-search.test';
import './sku.test';
import './import-schemas.test';
import './import-coerce.test';
import './import-automap.test';
import './import-parse.test';
import './import-classify.test';
import './import-csvout.test';
import './aes-gcm.test';
import './license-machine-match.test';
import './si-number.test';
import './drawer-kick.test';
import './receipt-si-number.test';
import './receipt-document-type.test';
import './reprint-watermark.test';
import './z-reading-discount-summary.test';
import './z-reading-or-range.test';
import './z-reading-record-before-print.test';
import './discount-line-targeting.test';
import './reprint-watermark-browser.test';
import './ejournal-text-format.test';
import './ejournal-text-receipt.test';
import './ejournal-data.test';
import './ejournal-writer.test';
import './product-type.test';
import './manual-screens.test';
import './manual-overlay.test';
import './manual-content.test';
import './manual-build.test';
import './manual-pdf.test';
import './stock-count-baseline.test';
import './sta-lucia-payload.test';
import './sta-lucia-hourly-payload.test';
import './sta-lucia-client-409.test';
import './price-update-math.test';
import './price-list-template.test';
import './price-list-import-match.test';
import './price-list-import-chunking.test';
import './low-stock-alerts.test';
import './seed-default-price-level.test';
import './price-level-calc.test';
import './price-level-calculation.test';
import './bir-or-number.test';
import './mixed-cart-validation.test';
import './checkout-si-or-routing.test';
import './x-reading-or-range.test';
import './x-reading-void-source.test';
import './x-reading-returns-shift.test';
import './product-search.test';
import './board-product-loading.test';
import './board-search-no-remount.test';
import './terminal-lock-check.test';
import './checkout-terminal-lock.test';
import './business-date-lock-lifecycle.test';
import './license-state-store.test';
import './license-resolution-order.test';
import './license-heartbeat-transitions.test';
import './license-seat-overage.test';
import './license-features.test';
import './product-markup-resolution.test';
import './markup-validation.test';
import './selling-units.test';
import './selling-unit-rows.test';
import './warehouse-sibling-barcode.test';
import './pos-cart-units.test';
import './cart-quantity-format.test';
import './decimal-quantity-read.test';
import './stock-quantity-format.test';
import './pricing.test';
import './process-return-leg.test';
import './process-sale-leg.test';
import './checkout-cart-prefetch.test';
import './exchange-balance.test';
import './exchange-slip-generator.test';
import './exchange-tender.test';
import './unit-quantity.test';
import './batch-expiration-edit.test';
import './batch-expiration-write.test';

// Each test file above is a side-effecting async IIFE: it starts running during
// import but settles only after every import has completed. The DB-backed ones
// then leave lib/mysql's connection pool and its cron workers holding the event
// loop open, so the process never exits by itself.
//
// This single exit replaces the per-file process.exit(0) that bir-or-number,
// process-sale-leg and process-return-leg used to call. That exit fired as soon
// as the first of them settled, killing the runner before the files imported
// after it ever ran — so those tests were silently skipped by `npm run test:unit`
// while still passing when run individually.
//
// The DB-backed tests are the only ones that need waiting for, and each asserts
// inside a transaction it then rolls back, so a fixed grace period is enough:
// they are fast queries against a local DB, and a slow one only delays the exit,
// never corrupts a result. A failing test exits non-zero from its own catch
// block before this fires.
//
// If a DB-backed test is added that needs longer, raise this — or better, make
// the test files export their promises so this can await them properly.
const SETTLE_MS = 20_000;
const exitTimer = setTimeout(() => process.exit(0), SETTLE_MS);
// Don't let the timer itself be the reason the process stays alive.
exitTimer.unref?.();
