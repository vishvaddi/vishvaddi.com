// First-fit-decreasing 1D bin packing for cut lists. Pure, deterministic, no I/O.
export interface CutPiece { name: string; length: number; qty: number }
export interface Placed { name: string; length: number }
export interface Bin { pieces: Placed[]; used: number; remaining: number; stock: number }
export interface PackResult {
  bins: Bin[];
  oversize: Placed[]; // pieces longer than a stock length — cannot be cut
}

export function binPackFFD(pieces: CutPiece[], stockLen: number, kerf: number): PackResult {
  const flat: Placed[] = [];
  for (const p of pieces) {
    for (let i = 0; i < p.qty; i++) flat.push({ name: p.name, length: p.length });
  }
  flat.sort((a, b) => b.length - a.length);

  const bins: Bin[] = [];
  const oversize: Placed[] = [];

  for (const piece of flat) {
    if (piece.length > stockLen) { oversize.push(piece); continue; }
    let placed = false;
    for (const bin of bins) {
      // each additional piece in a bin needs a kerf (saw cut) before it
      if (bin.remaining >= piece.length + kerf) {
        bin.pieces.push(piece);
        bin.used += piece.length + kerf;
        bin.remaining -= piece.length + kerf;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bins.push({
        pieces: [piece],
        used: piece.length,
        remaining: stockLen - piece.length,
        stock: stockLen,
      });
    }
  }
  return { bins, oversize };
}
