// 1D cut-list packing. Best-fit-decreasing across one OR several stock lengths.
// Pure, deterministic, no I/O.
export interface CutPiece { name: string; length: number; qty: number }
export interface Placed { name: string; length: number }
export interface Bin { stock: number; pieces: Placed[]; used: number; remaining: number }
export interface PackResult {
  bins: Bin[];
  oversize: Placed[]; // longer than the longest stock — cannot be cut
}

export interface LinearStock { name: string; length: number; qty: number; cost?: number }
export interface AdvancedBin extends Omit<Bin, 'stock'> { stock: LinearStock; kerfLoss: number; trimLoss: number }
export interface AdvancedPackResult { bins: AdvancedBin[]; oversize: Placed[]; cost: number; kerfLoss: number; trimLoss: number }

export function packAdvanced(pieces: CutPiece[], stocks: LinearStock[], kerf: number, trim: number): AdvancedPackResult {
  const flat: Placed[] = []
  for (const piece of pieces) for (let i = 0; i < piece.qty; i++) flat.push({ name: piece.name, length: piece.length })
  flat.sort((a, b) => b.length - a.length)
  const valid = stocks.filter((stock) => stock.length > trim * 2).sort((a, b) => a.length - b.length)
  const opened = new Map<LinearStock, number>()
  const bins: AdvancedBin[] = []
  const oversize: Placed[] = []
  kerf = Math.max(0, kerf); trim = Math.max(0, trim)

  for (const piece of flat) {
    let best: AdvancedBin | null = null
    let bestLeft = Infinity
    for (const bin of bins) {
      const need = piece.length + (bin.pieces.length ? kerf : 0)
      if (bin.remaining >= need && bin.remaining - need < bestLeft) { best = bin; bestLeft = bin.remaining - need }
    }
    if (best) {
      const cutKerf = best.pieces.length ? kerf : 0
      best.pieces.push(piece); best.used += piece.length; best.kerfLoss += cutKerf; best.remaining -= piece.length + cutKerf
      continue
    }
    const stock = valid.find((candidate) => candidate.length - trim * 2 >= piece.length && (candidate.qty <= 0 || (opened.get(candidate) ?? 0) < candidate.qty))
    if (!stock) { oversize.push(piece); continue }
    opened.set(stock, (opened.get(stock) ?? 0) + 1)
    bins.push({ stock, pieces: [piece], used: piece.length, remaining: stock.length - trim * 2 - piece.length, kerfLoss: 0, trimLoss: trim * 2 })
  }
  return {
    bins, oversize,
    cost: bins.reduce((sum, bin) => sum + (bin.stock.cost ?? 0), 0),
    kerfLoss: bins.reduce((sum, bin) => sum + bin.kerfLoss, 0),
    trimLoss: bins.reduce((sum, bin) => sum + bin.trimLoss, 0),
  }
}

export function pack(pieces: CutPiece[], stocks: number[], kerf: number): PackResult {
  const flat: Placed[] = [];
  for (const p of pieces) {
    for (let i = 0; i < p.qty; i++) flat.push({ name: p.name, length: p.length });
  }
  flat.sort((a, b) => b.length - a.length);

  // unique stock lengths, ascending (so we can pick the smallest that fits)
  const stockSorted = [...new Set(stocks.filter((s) => s > 0))].sort((a, b) => a - b);
  const maxStock = stockSorted.length ? stockSorted[stockSorted.length - 1] : 0;

  const bins: Bin[] = [];
  const oversize: Placed[] = [];

  for (const piece of flat) {
    if (!maxStock || piece.length > maxStock) {
      oversize.push(piece);
      continue;
    }
    // best-fit into an existing bin (smallest leftover wins → tightest pack)
    let best: Bin | null = null;
    let bestLeft = Infinity;
    for (const bin of bins) {
      const need = piece.length + (bin.pieces.length ? kerf : 0);
      if (bin.remaining >= need) {
        const left = bin.remaining - need;
        if (left < bestLeft) { bestLeft = left; best = bin; }
      }
    }
    if (best) {
      const need = piece.length + (best.pieces.length ? kerf : 0);
      best.pieces.push(piece);
      best.used += piece.length;
      best.remaining -= need;
    } else {
      // open a new bin on the smallest stock length that fits this piece
      const stock = stockSorted.find((s) => s >= piece.length)!;
      bins.push({ stock, pieces: [piece], used: piece.length, remaining: stock - piece.length });
    }
  }
  return { bins, oversize };
}
