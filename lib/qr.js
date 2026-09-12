'use strict';

/*
 * Minimal QR encoder. Byte mode, error correction level L, versions 1-5.
 * Versions 1-5 at level L are single-block, which avoids block interleaving
 * entirely. Capacity tops out at 108 bytes, far more than any portal URL.
 *
 * Output is SVG so it prints crisply at any size with no image files.
 */

const CAPACITY = { 1: 19, 2: 34, 3: 55, 4: 80, 5: 108 };
const ECC_COUNT = { 1: 7, 2: 10, 3: 15, 4: 20, 5: 26 };
const TOTAL = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134 };
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30] };

// --------------------------------------------------------- galois field ---

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function reedSolomon(data, eccLength) {
  const gen = generatorPoly(eccLength);
  const result = new Array(eccLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < eccLength; i++) {
      result[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return result;
}

// ------------------------------------------------------------- encoding ---

function encodeData(text, version) {
  const bytes = Array.from(Buffer.from(text, 'utf8'));
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);          // byte mode
  push(bytes.length, 8);    // count indicator, 8 bits for versions 1-9
  for (const b of bytes) push(b, 8);

  const capacityBits = CAPACITY[version] * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }

  const pad = [0xec, 0x11];
  let p = 0;
  while (codewords.length < CAPACITY[version]) codewords.push(pad[p++ % 2]);

  return codewords.concat(reedSolomon(codewords, ECC_COUNT[version]));
}

function pickVersion(text) {
  const length = Buffer.byteLength(text, 'utf8');
  for (const v of [1, 2, 3, 4, 5]) {
    if (length <= CAPACITY[v]) return v;
  }
  throw new Error(`Text too long for this QR encoder (${length} bytes, max ${CAPACITY[5]}).`);
}

// --------------------------------------------------------------- matrix ---

function buildMatrix(version, codewords, mask) {
  const size = 17 + version * 4;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFn = (r, c, value) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r][c] = value;
    reserved[r][c] = true;
  };

  // Finder patterns plus their separators.
  const finder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const ring = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setFn(row + r, col + c, inner && (ring || core) ? 1 : 0);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    setFn(6, i, i % 2 === 0 ? 1 : 0);
    setFn(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // Alignment patterns, skipping any that collide with a finder.
  const centres = ALIGN[version];
  for (const r of centres) {
    for (const c of centres) {
      const nearFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const edge = Math.abs(dr) === 2 || Math.abs(dc) === 2;
          const centre = dr === 0 && dc === 0;
          setFn(r + dr, c + dc, edge || centre ? 1 : 0);
        }
      }
    }
  }

  // Dark module.
  setFn(size - 8, 8, 1);

  // Reserve the format information areas before laying out data.
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) { modules[8][i] = 0; reserved[8][i] = true; }
    if (!reserved[i][8]) { modules[i][8] = 0; reserved[i][8] = true; }
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) { modules[8][size - 1 - i] = 0; reserved[8][size - 1 - i] = true; }
    if (!reserved[size - 1 - i][8]) { modules[size - 1 - i][8] = 0; reserved[size - 1 - i][8] = true; }
  }

  // Data placement: two-module-wide columns, right to left, zig-zagging.
  const bits = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  }

  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // skip the vertical timing column
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        if (reserved[row][col]) continue;
        let bit = bitIndex < bits.length ? bits[bitIndex++] : 0;
        if (maskApplies(mask, row, col)) bit ^= 1;
        modules[row][col] = bit;
      }
    }
    upward = !upward;
  }

  writeFormat(modules, size, mask);
  return modules;
}

function maskApplies(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function writeFormat(modules, size, mask) {
  // Level L is 0b01. Five bits of data, then BCH(15,5), then the fixed XOR.
  const data = (0b01 << 3) | mask;
  let value = data << 10;
  for (let i = 4; i >= 0; i--) {
    if ((value >> (i + 10)) & 1) value ^= 0x537 << i;
  }
  const format = ((data << 10) | value) ^ 0x5412;

  for (let i = 0; i < 15; i++) {
    const bit = (format >> i) & 1;

    // Vertical strip down column 8, skipping the timing row.
    if (i < 6) modules[i][8] = bit;
    else if (i < 8) modules[i + 1][8] = bit;
    else modules[size - 15 + i][8] = bit;

    // Horizontal strip along row 8, skipping the timing column.
    if (i < 8) modules[8][size - 1 - i] = bit;
    else if (i === 8) modules[8][7] = bit;
    else modules[8][14 - i] = bit;
  }

  modules[size - 8][8] = 1; // dark module stays set
}

// ------------------------------------------------------------- penalties ---

function penalty(modules) {
  const size = modules.length;
  let score = 0;

  // Rule 1: runs of five or more identical modules in a row or column.
  for (let i = 0; i < size; i++) {
    for (const axis of [0, 1]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        const prev = axis ? modules[j - 1][i] : modules[i][j - 1];
        const curr = axis ? modules[j][i] : modules[i][j];
        if (curr === prev) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 3: finder-like patterns.
  const pattern = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const reversed = pattern.slice().reverse();
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size - 10; c++) {
      let matchA = true;
      let matchB = true;
      let matchC = true;
      let matchD = true;
      for (let k = 0; k < 11; k++) {
        if (modules[r][c + k] !== pattern[k]) matchA = false;
        if (modules[r][c + k] !== reversed[k]) matchB = false;
        if (modules[c + k][r] !== pattern[k]) matchC = false;
        if (modules[c + k][r] !== reversed[k]) matchD = false;
      }
      if (matchA) score += 40;
      if (matchB) score += 40;
      if (matchC) score += 40;
      if (matchD) score += 40;
    }
  }

  // Rule 4: deviation from an even split of dark and light.
  let dark = 0;
  for (const row of modules) for (const v of row) if (v) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

// ---------------------------------------------------------------- public ---

function encode(text) {
  const version = pickVersion(text);
  const codewords = encodeData(text, version);
  if (codewords.length !== TOTAL[version]) {
    throw new Error(`Internal error: expected ${TOTAL[version]} codewords, built ${codewords.length}`);
  }

  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = buildMatrix(version, codewords, mask);
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** Render to SVG. `quiet` is the mandatory light border, in modules. */
function toSvg(text, options) {
  const opts = options || {};
  const scale = opts.scale || 8;
  const quiet = opts.quiet === undefined ? 4 : opts.quiet;
  const modules = encode(text);
  const size = modules.length;
  const total = (size + quiet * 2) * scale;

  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) {
        path += `M${(c + quiet) * scale} ${(r + quiet) * scale}h${scale}v${scale}h-${scale}z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
    `<path d="${path}" fill="#000000"/></svg>`;
}

module.exports = { encode, toSvg };
