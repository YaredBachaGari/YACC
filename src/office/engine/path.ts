// Walkable tile grid + BFS pathfinding (4-way).

export type Tile = [number, number];

export class WalkGrid {
  readonly cells: Uint8Array;

  constructor(readonly w: number, readonly h: number) {
    this.cells = new Uint8Array(w * h);
  }

  set(x0: number, y0: number, x1: number, y1: number, walkable: boolean) {
    for (let y = Math.max(0, y0); y <= Math.min(this.h - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) this.cells[y * this.w + x] = walkable ? 1 : 0;
  }

  ok(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.cells[y * this.w + x] === 1;
  }

  /** Nearest walkable tile to (x, y), searching outward. */
  nearest(x: number, y: number): Tile {
    if (this.ok(x, y)) return [x, y];
    for (let r = 1; r < Math.max(this.w, this.h); r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r && this.ok(x + dx, y + dy)) return [x + dx, y + dy];
    return [x, y];
  }

  /** Path from start to goal (excluding start). The goal may be a blocked tile (e.g. a seat). */
  find(sx: number, sy: number, tx: number, ty: number): Tile[] {
    const W = this.w;
    const start = sy * W + sx;
    const goal = ty * W + tx;
    if (start === goal) return [];
    const prev = new Int32Array(W * this.h).fill(-1);
    const q = [start];
    prev[start] = start;
    for (let i = 0; i < q.length; i++) {
      const cur = q[i];
      if (cur === goal) break;
      const cx = cur % W;
      const cy = (cur / W) | 0;
      const nbrs: Tile[] = [[cx, cy + 1], [cx + 1, cy], [cx, cy - 1], [cx - 1, cy]];
      for (const [nx, ny] of nbrs) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= this.h) continue;
        const ni = ny * W + nx;
        if (prev[ni] !== -1 || (!this.cells[ni] && ni !== goal)) continue;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    if (prev[goal] === -1) return [];
    const path: Tile[] = [];
    for (let c = goal; c !== start; c = prev[c]) path.push([c % W, (c / W) | 0]);
    return path.reverse();
  }
}
