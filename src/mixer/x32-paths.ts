/**
 * Mixing Station paths ↔ X32 OSC addresses, for the parameters fader-now
 * drives. Mixing Station counts from 0 and the X32 from 1, so `ch.0` is
 * `/ch/01`. The supported set is deliberately small; anything else throws.
 */

import type { MixerPath } from "./driver.js";

/** How a parameter's value is carried: a dB fader, or an on/off switch. */
export type ParamKind = "level" | "on";

const BANK_SIZE = { ch: 32, bus: 16 } as const;
type Bank = keyof typeof BANK_SIZE;

const MS_PARAM = { lvl: "fader", on: "on" } as const;
const X32_PARAM = { fader: "lvl", on: "on" } as const;
const KIND = { lvl: "level", on: "on" } as const;

export function toX32(path: MixerPath): { address: string; kind: ParamKind } {
  const m = /^(ch|bus)\.(\d+)\.mix\.(lvl|on)$/.exec(path);
  if (!m) throw new Error(`unsupported mixer path "${path}"`);
  const bank = m[1] as Bank;
  const index = Number(m[2]);
  if (index >= BANK_SIZE[bank]) {
    throw new Error(`mixer path "${path}": ${bank} index must be 0..${BANK_SIZE[bank] - 1}`);
  }
  const param = m[3] as keyof typeof MS_PARAM;
  const nn = String(index + 1).padStart(2, "0");
  return { address: `/${bank}/${nn}/mix/${MS_PARAM[param]}`, kind: KIND[param] };
}

/** The path for an X32 address, or null if it's outside the supported set. */
export function fromX32(address: string): { path: MixerPath; kind: ParamKind } | null {
  const m = /^\/(ch|bus)\/(\d\d)\/mix\/(fader|on)$/.exec(address);
  if (!m) return null;
  const bank = m[1] as Bank;
  const index = Number(m[2]) - 1;
  if (index < 0 || index >= BANK_SIZE[bank]) return null;
  const param = X32_PARAM[m[3] as keyof typeof X32_PARAM];
  return { path: `${bank}.${index}.mix.${param}`, kind: KIND[param] };
}
