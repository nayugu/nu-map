// Dependency-free QR Code generator — byte mode only, versions 1–40, automatic
// version + mask selection. Adapted from Nayuki's public-domain QR Code
// generator (https://www.nayuki.io/page/qr-code-generator-library), trimmed to
// exactly what NU Map needs: turn a share URL into a scannable module matrix
// with no npm dependency (mirrors how planShare.js hand-rolls gzip/base64).
//
// generateQr(text) → { size, modules } where modules[y][x] is true for a dark
// module, or null if the text is too long to fit even a version-40 code.

const MIN_VERSION = 1;
const MAX_VERSION = 40;

// [eclOrdinal][version] — number of error-correction codewords per block.
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Low
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // Medium
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Quartile
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // High
];

// [eclOrdinal][version] — number of error-correction blocks.
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // Low
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // Medium
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Quartile
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81], // High
];

// Error-correction level: `ordinal` indexes the tables above, `formatBits` goes
// into the format-information string, `tag` is the public label.
const ECL_LOW = { ordinal: 0, formatBits: 1, tag: "L" };
const ECL_MEDIUM = { ordinal: 1, formatBits: 0, tag: "M" };
const ECL_QUARTILE = { ordinal: 2, formatBits: 3, tag: "Q" };
const ECL_HIGH = { ordinal: 3, formatBits: 2, tag: "H" };

const getBit = (x, i) => ((x >>> i) & 1) !== 0;

// ── Capacity math ──────────────────────────────────────────────────────────

function getNumRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function getNumDataCodewords(ver, ecl) {
  return (
    Math.floor(getNumRawDataModules(ver) / 8) -
    ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver]
  );
}

// ── Byte-mode data encoding ──────────────────────────────────────────────────

// Returns { version, dataCodewords } or null if `text` is too long for the ECL.
function encodeText(text, ecl) {
  const bytes = new TextEncoder().encode(text);

  let version;
  for (version = MIN_VERSION; ; version++) {
    const capacityBits = getNumDataCodewords(version, ecl) * 8;
    const ccBits = version < 10 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= capacityBits) break;
    if (version >= MAX_VERSION) return null;
  }

  const bb = []; // bit buffer, one entry per bit
  const appendBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bb.push((val >>> i) & 1);
  };

  appendBits(0x4, 4); // byte-mode indicator
  appendBits(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) appendBits(b, 8);

  const capacityBits = getNumDataCodewords(version, ecl) * 8;
  appendBits(0, Math.min(4, capacityBits - bb.length)); // terminator
  appendBits(0, (8 - (bb.length % 8)) % 8); // byte-align
  for (let pad = 0xec; bb.length < capacityBits; pad ^= 0xec ^ 0x11) appendBits(pad, 8);

  const dataCodewords = new Array(bb.length / 8).fill(0);
  bb.forEach((bit, i) => (dataCodewords[i >>> 3] |= bit << (7 - (i & 7))));
  return { version, dataCodewords };
}

// ── Reed-Solomon error correction (GF(256), primitive 0x11D) ─────────────────

function reedSolomonMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function reedSolomonComputeDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = reedSolomonMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonComputeRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i++) result[i] ^= reedSolomonMultiply(divisor[i], factor);
  }
  return result;
}

// Split data into blocks, append EC codewords, and interleave.
function addEccAndInterleave(dataCodewords, version, ecl) {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][version];
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks = [];
  const rsDiv = reedSolomonComputeDivisor(blockEccLen);
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = dataCodewords.slice(k, k + datLen);
    k += datLen;
    const ecc = reedSolomonComputeRemainder(dat, rsDiv);
    if (i < numShortBlocks) dat.push(0); // pad short blocks so interleave aligns
    blocks.push(dat.concat(ecc));
  }

  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      // Skip the padding cell that short blocks carry in the data region.
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(blocks[j][i]);
    }
  }
  return result;
}

// ── Module matrix construction ───────────────────────────────────────────────

function getAlignmentPatternPositions(ver) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

function buildMatrix(version, ecl, dataCodewords) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFn = (x, y, dark) => {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  // Format-information bits (drawn once as a placeholder, then per candidate mask).
  const drawFormatBits = (mask) => {
    const data = (ecl.formatBits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, getBit(bits, i));
    setFn(8, 7, getBit(bits, 6));
    setFn(8, 8, getBit(bits, 7));
    setFn(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(bits, i));
    setFn(8, size - 8, true); // always-dark module
  };

  // Timing patterns
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  // Finder patterns + separators (three corners)
  const drawFinder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  // Alignment patterns (skip the three finder corners)
  const alignPos = getAlignmentPatternPositions(version);
  const n = alignPos.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      const cx = alignPos[i];
      const cy = alignPos[j];
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  // Version information (version 7+)
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, bit);
      setFn(b, a, bit);
    }
  }

  drawFormatBits(0); // reserve format modules

  // Draw the data + EC codewords in the zigzag pattern.
  const allCodewords = addEccAndInterleave(dataCodewords, version, ecl);
  let bit = 0;
  const totalBits = allCodewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let c = 0; c < 2; c++) {
        const x = right - c;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bit < totalBits) {
          modules[y][x] = getBit(allCodewords[bit >>> 3], 7 - (bit & 7));
          bit++;
        }
      }
    }
  }

  // Masking: XOR a pattern over the non-function modules.
  const applyMask = (mask) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isFunction[y][x]) continue;
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert) modules[y][x] = !modules[y][x];
      }
    }
  };

  // Pick the mask with the lowest penalty score.
  let bestMask = 0;
  let minPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormatBits(mask);
    const penalty = penaltyScore(modules, size);
    if (penalty < minPenalty) {
      minPenalty = penalty;
      bestMask = mask;
    }
    applyMask(mask); // undo (XOR is its own inverse)
  }
  applyMask(bestMask);
  drawFormatBits(bestMask);

  return { size, modules };
}

// ── Penalty scoring (mask selection) ─────────────────────────────────────────

function penaltyScore(modules, size) {
  let result = 0;

  const countPatterns = (h) => {
    const nn = h[1];
    const core = nn > 0 && h[2] === nn && h[3] === nn * 3 && h[4] === nn && h[5] === nn;
    return (
      (core && h[0] >= nn * 4 && h[6] >= nn ? 1 : 0) + (core && h[6] >= nn * 4 && h[0] >= nn ? 1 : 0)
    );
  };
  const addHistory = (runLen, h) => {
    if (h[0] === 0) runLen += size; // light border before the first run
    h.pop();
    h.unshift(runLen);
  };
  const terminate = (runColor, runLen, h) => {
    if (runColor) {
      addHistory(runLen, h);
      runLen = 0;
    }
    runLen += size; // light border after the last run
    addHistory(runLen, h);
    return countPatterns(h);
  };

  // Rows
  for (let y = 0; y < size; y++) {
    let runColor = false;
    let runLen = 0;
    const h = [0, 0, 0, 0, 0, 0, 0];
    for (let x = 0; x < size; x++) {
      if (modules[y][x] === runColor) {
        runLen++;
        if (runLen === 5) result += 3;
        else if (runLen > 5) result++;
      } else {
        addHistory(runLen, h);
        if (!runColor) result += countPatterns(h) * 40;
        runColor = modules[y][x];
        runLen = 1;
      }
    }
    result += terminate(runColor, runLen, h) * 40;
  }
  // Columns
  for (let x = 0; x < size; x++) {
    let runColor = false;
    let runLen = 0;
    const h = [0, 0, 0, 0, 0, 0, 0];
    for (let y = 0; y < size; y++) {
      if (modules[y][x] === runColor) {
        runLen++;
        if (runLen === 5) result += 3;
        else if (runLen > 5) result++;
      } else {
        addHistory(runLen, h);
        if (!runColor) result += countPatterns(h) * 40;
        runColor = modules[y][x];
        runLen = 1;
      }
    }
    result += terminate(runColor, runLen, h) * 40;
  }

  // 2x2 blocks of one color
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += 3;
    }
  }

  // Dark/light balance
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) dark++;
  const total = size * size;
  const kk = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += kk * 10;

  return result;
}

// ── Public entry point ───────────────────────────────────────────────────────

// Pick the STRONGEST error correction the text fits into at all, and accept
// whatever version that needs. Returns { size, modules, ecl }
// (ecl = "H"|"Q"|"M"|"L"), or null if the text fits none of them.
//
// This used to prefer the smallest version instead, spending the slack on
// error correction only when it was free. That was the right rule when a QR
// carried a whole bit-packed plan and version growth was the thing to fear.
// It is the wrong rule now that a QR carries a ~27-character share-code link:
// measured, that 27-character link fits version 2 at LOW EC, so the old rule
// pinned it to Low — the most fragile setting — to save eight modules of
// width. High EC takes version 4 instead: 33 modules against 25, which in the
// 136px preview is 4.1px per module against 5.4px, still far above what a
// phone camera needs. That buys 30% damage tolerance and the module budget
// QrArt's dots and centre logo spend. Both the production and the dev origin
// land on version 4, so the QR renders identically in both.
export function generateQr(text) {
  for (const ecl of [ECL_HIGH, ECL_QUARTILE, ECL_MEDIUM, ECL_LOW]) {
    const enc = encodeText(text, ecl);
    if (enc) return { ...buildMatrix(enc.version, ecl, enc.dataCodewords), ecl: ecl.tag };
  }
  return null;
}
