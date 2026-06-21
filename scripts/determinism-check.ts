// Quick determinism check: generating the same chunk twice (and with two seeds)
// must yield byte-identical data + identical feature decisions for one seed.
import { generateChunk } from '../src/core/WorldGen';

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const SEED = 1337;
let ok = true;

for (const [cx, cz] of [
  [0, 0],
  [3, -2],
  [-5, 7],
] as const) {
  const a = generateChunk(cx, cz, SEED);
  const b = generateChunk(cx, cz, SEED);
  const dataSame = eqBytes(a.data, b.data);
  const biomeSame = eqBytes(a.biomeMap, b.biomeMap);
  const featSame = JSON.stringify(a.features) === JSON.stringify(b.features);
  console.log(
    `chunk ${cx},${cz}: data=${dataSame} biome=${biomeSame} features=${featSame} (${a.features.length} features)`,
  );
  if (!dataSame || !biomeSame || !featSame) ok = false;
}

// Different seed should differ.
const s1 = generateChunk(0, 0, 1337);
const s2 = generateChunk(0, 0, 9999);
const differ = !eqBytes(s1.data, s2.data);
console.log(`different seeds differ: ${differ}`);
if (!differ) ok = false;

console.log(ok ? 'DETERMINISM: PASS' : 'DETERMINISM: FAIL');
process.exit(ok ? 0 : 1);
