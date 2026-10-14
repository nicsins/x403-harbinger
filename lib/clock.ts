/** Clock indirection so monitor tests can advance a deadline without sleeping. */

let override: (() => number) | null = null;

export function nowMs(): number {
  return override ? override() : Date.now();
}

/** Tests only. Pass null to restore Date.now. */
export function setClockForTests(fn: (() => number) | null): void {
  override = fn;
}
