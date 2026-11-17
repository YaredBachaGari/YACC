// A small line diff (longest common subsequence), for showing a proposed change to a role's
// instructions. Fine for the few hundred lines instructions run to.

export interface DiffLine {
  op: "same" | "add" | "remove";
  text: string;
}

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");
  // Too long to compare line by line: show it as replaced.
  if (a.length * b.length > 4_000_000) return [...a.map((text) => ({ op: "remove" as const, text })), ...b.map((text) => ({ op: "add" as const, text }))];
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ op: "remove", text: a[i++] });
    else out.push({ op: "add", text: b[j++] });
  }
  while (i < a.length) out.push({ op: "remove", text: a[i++] });
  while (j < b.length) out.push({ op: "add", text: b[j++] });
  return out;
}

/** The diff with unchanged runs longer than 2·context folded to "…" lines (op "same", text null-marked). */
export function foldDiff(lines: DiffLine[], context = 2): (DiffLine | { op: "fold"; count: number })[] {
  const out: (DiffLine | { op: "fold"; count: number })[] = [];
  let run: DiffLine[] = [];
  const flush = (atStart: boolean, atEnd: boolean) => {
    const keepHead = atStart ? 0 : context;
    const keepTail = atEnd ? 0 : context;
    if (run.length > keepHead + keepTail + 1) {
      out.push(...run.slice(0, keepHead), { op: "fold", count: run.length - keepHead - keepTail }, ...run.slice(run.length - keepTail));
    } else out.push(...run);
    run = [];
  };
  let first = true;
  for (const l of lines) {
    if (l.op === "same") run.push(l);
    else {
      flush(first, false);
      first = false;
      out.push(l);
    }
  }
  flush(first, true);
  return out;
}
