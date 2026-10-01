/**
 * Build the browser teleprompter client (TS -> one self-contained IIFE).
 *
 * The client can't ship as an ES module — bundles run over file://, where module
 * imports fail — so it's bundled to a single IIFE. Building it from TypeScript is
 * what lets the client `import` the REAL shared modules (Curve, loop) instead of
 * hand-porting them into the browser file, which is how live/bundle timing logic
 * used to drift apart.
 *
 * The output `teleprompter.js` sits next to index.html (a build artifact, not
 * checked in). Every consumer builds it before serving/copying: the relay
 * (startTeleprompter), the bundle builder, and `npm run build`.
 */

import * as esbuild from "esbuild";
import { join } from "node:path";

/** Default client source/output directory (next to this module). */
export const clientDir = join(import.meta.dirname, "client");

/** Bundle client/teleprompter.ts -> client/teleprompter.js (IIFE). Fast (~ms). */
export async function buildClient(dir = clientDir): Promise<void> {
  await esbuild.build({
    // The lyrics display and the control bar share show-state, so the bail
    // logic can't drift between them. The e-ink client shares eink/layout
    // with the relay's page renderer, and eink-page is the page that renderer
    // draws in headless Chrome, with the prompter's own pane-view.
    entryPoints: [join(dir, "teleprompter.ts"), join(dir, "control.ts"), join(dir, "eink.ts"), join(dir, "eink-page.ts")],
    outdir: dir,
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2018",
    logLevel: "warning",
  });
}
