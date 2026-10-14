/**
 * The split page: one-view prompter pages tiled in iframes, so a tablet shows
 * two to four parts at once without arranging browser windows. Stacked in
 * portrait, side by side in landscape. Dragging a divider moves it and writes
 * the new position into the URL, so a setup stays a link.
 */

import { frameSrc, parseSplit, withSplitAt } from "../split-options.js";

const root = document.getElementById("split")!;
const parsed = parseSplit(location.search);

if ("error" in parsed) {
  root.innerHTML = '<div id="error"></div>';
  root.firstElementChild!.textContent = "This split link can't be shown: " + parsed.error + ".";
} else {
  const at = parsed.at.slice();
  const frames = parsed.views.map((view) => {
    const frame = document.createElement("iframe");
    frame.src = frameSrc(view, location.search);
    frame.title = view;
    return frame;
  });
  const dividers = at.map(() => {
    const d = document.createElement("div");
    d.className = "divider";
    return d;
  });
  frames.forEach((f, i) => {
    root.appendChild(f);
    if (dividers[i]) root.appendChild(dividers[i]);
  });

  const across = () => window.innerWidth > window.innerHeight;
  const DIVIDER_PX = 10;

  /** Size each frame to its share of the screen, less its part of the dividers. */
  function layout() {
    root.classList.toggle("across", across());
    const edges = [0, ...at, 100];
    frames.forEach((f, i) => {
      const share = edges[i + 1] - edges[i];
      const size = `calc(${share}% - ${(DIVIDER_PX * dividers.length) / frames.length}px)`;
      f.style.width = across() ? size : "100%";
      f.style.height = across() ? "100%" : size;
    });
  }

  dividers.forEach((d, i) => {
    d.addEventListener("pointerdown", (e) => {
      d.setPointerCapture(e.pointerId);
      root.classList.add("dragging");
    });
    d.addEventListener("pointermove", (e) => {
      if (!d.hasPointerCapture(e.pointerId)) return;
      const pct = across() ? (e.clientX / window.innerWidth) * 100 : (e.clientY / window.innerHeight) * 100;
      // Every frame keeps a tenth of the screen.
      const lo = (i === 0 ? 0 : at[i - 1]) + 10;
      const hi = (i === at.length - 1 ? 100 : at[i + 1]) - 10;
      at[i] = Math.min(hi, Math.max(lo, pct));
      layout();
    });
    const done = (e: PointerEvent) => {
      if (!d.hasPointerCapture(e.pointerId)) return;
      d.releasePointerCapture(e.pointerId);
      root.classList.remove("dragging");
      try { history.replaceState(null, "", location.pathname + withSplitAt(location.search, at)); } catch { /* file:// */ }
    };
    d.addEventListener("pointerup", done);
    d.addEventListener("pointercancel", done);
  });

  window.addEventListener("resize", layout);
  layout();
}
