/**
 * Treasury (payTo) address. Single source of truth: env TREASURY_ADDRESS.
 * Every NEW quote / accept / discovery surface advertises ONLY this address.
 */
export const DEFAULT_TREASURY_ADDRESS = "0xc22f9CAEBAc37fE72D5142f35f21f6696Ea9Ef69";

/**
 * Legacy payTo addresses. NEVER advertised. Used only when verifying receipts of
 * payments that already settled, so access that was paid before the switch keeps
 * working. Optional env LEGACY_PAY_TO_MAX_BLOCK (Base block number) limits legacy
 * credit to txs mined at or before the cutover block.
 */
export const LEGACY_PAY_TO: readonly string[] = ["0xDa1Eab46918882f8656a41cF9fCa80e2415369d1"];

// --- minimal keccak-256 (for EIP-55 checksum; no runtime deps) ---
const RC: bigint[] = [];
{
  let r = BigInt(1);
  for (let i = 0; i < 24; i++) {
    let rc = BigInt(0);
    for (let j = 0; j < 7; j++) {
      r = ((r << BigInt(1)) ^ ((r >> BigInt(7)) * BigInt(0x71))) & BigInt(0xff);
      if (r & BigInt(2)) rc ^= BigInt(1) << ((BigInt(1) << BigInt(j)) - BigInt(1));
    }
    RC.push(rc);
  }
}
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const M64 = (BigInt(1) << BigInt(64)) - BigInt(1);
const rotl = (x: bigint, n: number) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);

function keccakF(s: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    const c = [0, 1, 2, 3, 4].map((x) => s[x]! ^ s[x + 5]! ^ s[x + 10]! ^ s[x + 15]! ^ s[x + 20]!);
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1);
      for (let y = 0; y < 25; y += 5) s[x + y] = s[x + y]! ^ d;
    }
    const b: bigint[] = new Array(25).fill(BigInt(0));
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y]!, ROT[x + 5 * y]!);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        s[x + 5 * y] = b[x + 5 * y]! ^ (~b[((x + 1) % 5) + 5 * y]! & M64 & b[((x + 2) % 5) + 5 * y]!);
    s[0] = s[0]! ^ RC[round]!;
  }
}

export function keccak256Hex(input: Uint8Array): string {
  const rate = 136;
  const padLen = rate - (input.length % rate);
  const msg = new Uint8Array(input.length + padLen);
  msg.set(input);
  msg[input.length] ^= 0x01;
  msg[msg.length - 1] ^= 0x80;
  const s: bigint[] = new Array(25).fill(BigInt(0));
  for (let off = 0; off < msg.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = BigInt(0);
      for (let k = 7; k >= 0; k--) lane = (lane << BigInt(8)) | BigInt(msg[off + i * 8 + k]!);
      s[i] = s[i]! ^ lane;
    }
    keccakF(s);
  }
  let out = "";
  for (let i = 0; i < 4; i++) for (let k = 0; k < 8; k++) out += Number((s[i]! >> BigInt(8 * k)) & BigInt(0xff)).toString(16).padStart(2, "0");
  return out;
}

export function toChecksumAddress(addr: string): string {
  const lower = addr.toLowerCase().replace(/^0x/, "");
  const hash = keccak256Hex(new TextEncoder().encode(lower));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  return out;
}

/** Throws unless addr is a non-zero, EIP-55 checksummed address. */
export function assertChecksumAddress(addr: string, name = "TREASURY_ADDRESS"): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error(`${name} is not a valid EVM address`);
  if (/^0x0{40}$/.test(addr)) throw new Error(`${name} must not be the zero address`);
  if (toChecksumAddress(addr) !== addr) throw new Error(`${name} is not EIP-55 checksummed`);
  return addr;
}

function clean(v: string | undefined): string {
  return (v ?? "").trim().replace(/^["']|["']$/g, "");
}

/** Resolved at module load: an invalid TREASURY_ADDRESS fails startup/build. */
export const TREASURY_ADDRESS = assertChecksumAddress(clean(process.env.TREASURY_ADDRESS) || DEFAULT_TREASURY_ADDRESS);

/** Optional cutover block: legacy payTo credit only for txs mined at/before it. */
export function legacyMaxBlock(): bigint | null {
  const v = clean(process.env.LEGACY_PAY_TO_MAX_BLOCK);
  return /^\d+$/.test(v) ? BigInt(v) : null;
}
