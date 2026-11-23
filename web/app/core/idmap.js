// Package ids compare ignoring case (B407): dpkg and apt write every name in lower case (oreo), a source may not
// (Oreo), and the two are one package. IdMap and IdSet look ids up that way. Their keys come out in lower case, so
// take the spelling to show or send from the value (a row's id, a stanza's package), never from a key.
// SPDX-License-Identifier: GPL-3.0-or-later
import { lowerId } from "./queue.js";

export const sameId = (a, b) => lowerId(a) === lowerId(b);

// { id: name } with each name under dpkg's spelling of the id too: apt's status lines say oreo for a queued Oreo.
export function withLowerIds(names) {
  const out = { ...names };
  for (const [id, name] of Object.entries(names)) out[lowerId(id)] ??= name;
  return out;
}

export class IdMap extends Map {
  get(id) { return super.get(lowerId(id)); }
  has(id) { return super.has(lowerId(id)); }
  set(id, value) { return super.set(lowerId(id), value); }
  delete(id) { return super.delete(lowerId(id)); }
}

export class IdSet extends Set {
  has(id) { return super.has(lowerId(id)); }
  add(id) { return super.add(lowerId(id)); }
  delete(id) { return super.delete(lowerId(id)); }
}
