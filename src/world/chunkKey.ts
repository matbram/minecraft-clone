// Chunk map keys. String keys keep the Map debuggable; worker messages use raw ints.

export function chunkKey(cx: number, cz: number): string {
  return cx + ',' + cz;
}

export function parseKey(k: string): [number, number] {
  const i = k.indexOf(',');
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
}
