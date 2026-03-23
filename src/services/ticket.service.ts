/**
 * Ticket Generation Service
 *
 * Generates valid Tambola tickets with the following rules:
 * - 3 rows x 9 columns grid
 * - Each row has exactly 5 numbers and 4 blank spaces
 * - Column 1: 1-9, Column 2: 10-19, ..., Column 9: 80-90
 * - Total 15 unique numbers across the ticket
 * - Each column must have at least one number across all rows
 */

export type TambolaTicket = number[][]; // 3x9 grid, 0 = blank

const COLUMN_RANGES: [number, number][] = [
  [1, 9],
  [10, 19],
  [20, 29],
  [30, 39],
  [40, 49],
  [50, 59],
  [60, 69],
  [70, 79],
  [80, 90],
];

/**
 * Shuffles an array in place using Fisher-Yates algorithm
 */
function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generates a random number within a range (inclusive)
 */
function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generates a valid Tambola ticket
 */
export function generateTicket(): TambolaTicket {
  // Initialize 3x9 grid with zeros (blanks)
  const ticket: number[][] = Array(3)
    .fill(null)
    .map(() => Array(9).fill(0));

  // Step 1: Determine which columns will have numbers in each row
  // Each row must have exactly 5 numbers
  const rowColumnIndices: number[][] = [];

  for (let row = 0; row < 3; row++) {
    const availableColumns = Array.from({ length: 9 }, (_, i) => i);
    const selectedColumns = shuffle(availableColumns).slice(0, 5).sort();
    rowColumnIndices.push(selectedColumns);
  }

  // Step 2: Ensure each column has at least one number across all rows
  const columnCounts = Array(9).fill(0);
  rowColumnIndices.forEach((cols) => {
    cols.forEach((col) => columnCounts[col]++);
  });

  // Fix empty columns by swapping with columns that have 3 numbers
  for (let col = 0; col < 9; col++) {
    if (columnCounts[col] === 0) {
      // Find a column with 3 numbers
      const overfilledCol = columnCounts.findIndex((count) => count === 3);
      if (overfilledCol !== -1) {
        // Find a row where overfilledCol has a number but col doesn't
        for (let row = 0; row < 3; row++) {
          if (
            rowColumnIndices[row].includes(overfilledCol) &&
            !rowColumnIndices[row].includes(col)
          ) {
            // Swap
            const idx = rowColumnIndices[row].indexOf(overfilledCol);
            rowColumnIndices[row][idx] = col;
            rowColumnIndices[row].sort();
            columnCounts[col]++;
            columnCounts[overfilledCol]--;
            break;
          }
        }
      }
    }
  }

  // Step 3: Generate numbers for each column
  for (let col = 0; col < 9; col++) {
    const [min, max] = COLUMN_RANGES[col];
    const count = columnCounts[col];

    if (count === 0) continue;

    // Generate unique numbers for this column
    const availableNumbers = Array.from(
      { length: max - min + 1 },
      (_, i) => min + i
    );
    const selectedNumbers = shuffle(availableNumbers).slice(0, count).sort();

    // Assign numbers to rows
    let numIndex = 0;
    for (let row = 0; row < 3; row++) {
      if (rowColumnIndices[row].includes(col)) {
        ticket[row][col] = selectedNumbers[numIndex++];
      }
    }
  }

  return ticket;
}

/**
 * Extracts all numbers from a ticket (for indexing in Redis)
 */
export function getTicketNumbers(ticket: TambolaTicket): number[] {
  const numbers: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 9; col++) {
      if (ticket[row][col] !== 0) {
        numbers.push(ticket[row][col]);
      }
    }
  }
  return numbers;
}

/**
 * Gets the numbers in a specific row of the ticket
 */
export function getRowNumbers(ticket: TambolaTicket, rowIndex: number): number[] {
  if (rowIndex < 0 || rowIndex >= 3) {
    throw new Error('Invalid row index');
  }

  return ticket[rowIndex].filter((num) => num !== 0);
}

/**
 * Validates if a ticket follows Tambola rules
 */
// ─── Optimized Ticket Generation (co-designed with number sequence) ───

export interface TicketPoolEntry {
  ticket: TambolaTicket;
  e5: number;   // numbers called before Early 5
  tl: number;   // Top Line
  ml: number;   // Middle Line
  bl: number;   // Bottom Line
  fh: number;   // Full House
}

/**
 * Simulates a ticket against a number sequence and returns
 * at which number each category is achieved.
 */
function simulateTicket(ticket: TambolaTicket, sequence: number[]): { e5: number; tl: number; ml: number; bl: number; fh: number } {
  const row0 = new Set(ticket[0].filter(n => n > 0));
  const row1 = new Set(ticket[1].filter(n => n > 0));
  const row2 = new Set(ticket[2].filter(n => n > 0));
  const all = new Set([...Array.from(row0), ...Array.from(row1), ...Array.from(row2)]);

  let r0 = 0, r1 = 0, r2 = 0, total = 0;
  let e5 = 0, tl = 0, ml = 0, bl = 0, fh = 0;

  for (let i = 0; i < sequence.length; i++) {
    const num = sequence[i];
    const pos = i + 1;
    if (all.has(num)) {
      total++;
      if (row0.has(num)) r0++;
      if (row1.has(num)) r1++;
      if (row2.has(num)) r2++;
    }
    if (!e5 && total >= 5) e5 = pos;
    if (!tl && r0 >= 5) tl = pos;
    if (!ml && r1 >= 5) ml = pos;
    if (!bl && r2 >= 5) bl = pos;
    if (!fh && total >= 15) { fh = pos; break; }
  }
  return { e5: e5 || 90, tl: tl || 90, ml: ml || 90, bl: bl || 90, fh: fh || 90 };
}

const getCol = (n: number): number => n === 90 ? 8 : Math.floor((n - 1) / 10);

/**
 * Generates a single ticket optimized for a given number sequence.
 *
 * Strategy (Option A — fast game):
 * - Row 0: all 5 numbers from positions 0-19 → first line at ~15-22
 * - Row 1: 4 from positions 0-22 + 1 from positions 23-32 → second line at ~25-32
 * - Row 2: 4 from positions 0-25 + 1 from positions 30-42 → third line at ~35-42
 * - Early 5 at ~6-8 (most numbers are early)
 * - Full House = slowest line = ~35-42
 */
export function generateOptimizedTicket(sequence: number[]): TambolaTicket | null {
  // Three pools of numbers by their position in the calling sequence
  const band0 = sequence.slice(0, 22);  // pos 0-21 (all of row 0 + most of row 1)
  const band1 = sequence.slice(22, 33); // pos 22-32 (row 1's "wait" number)
  const band2 = sequence.slice(30, 43); // pos 30-42 (row 2's "wait" number)

  const byCol = (nums: number[]) => COLUMN_RANGES.map((_, c) =>
    shuffle(nums.filter(n => getCol(n) === c))
  );
  const band0ByCol = byCol(band0);
  const band1ByCol = byCol(band1);
  const band2ByCol = byCol(band2);

  const ticket: number[][] = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
  ];
  const used = new Set<number>();

  const place = (row: number, col: number, pool: number[]): boolean => {
    for (const n of pool) {
      if (!used.has(n) && getCol(n) === col) {
        ticket[row][col] = n;
        used.add(n);
        return true;
      }
    }
    return false;
  };

  // Assign 5 random columns per row, ensuring all 9 columns covered
  const allCols = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const row0Cols = shuffle(allCols).slice(0, 5).sort();

  const remaining = allCols.filter(c => !row0Cols.includes(c));
  const extras1 = shuffle(row0Cols).slice(0, 5 - remaining.length);
  const row1Cols = [...remaining, ...extras1].sort();

  const covered = new Set([...row0Cols, ...row1Cols]);
  const uncovered = allCols.filter(c => !covered.has(c));
  const row2Cols = [
    ...uncovered,
    ...shuffle(allCols.filter(c => !uncovered.includes(c))).slice(0, 5 - uncovered.length),
  ].slice(0, 5).sort();

  if (new Set([...row0Cols, ...row1Cols, ...row2Cols]).size < 9) return null;

  // Row 0: all 5 from band0 (fastest line, ~15-22)
  for (const col of row0Cols) {
    if (!place(0, col, band0ByCol[col])) return null;
  }

  // Row 1: 4 from band0 + 1 from band1 (second line, ~25-32)
  const waitCol1 = shuffle(row1Cols).find(c =>
    band1ByCol[c].some(n => !used.has(n))
  );
  for (const col of row1Cols) {
    if (col === waitCol1) {
      if (!place(1, col, band1ByCol[col])) {
        if (!place(1, col, band0ByCol[col])) return null;
      }
    } else {
      if (!place(1, col, band0ByCol[col])) return null;
    }
  }

  // Row 2: 4 from band0 + 1 from band2 (slowest line, ~35-42)
  const waitCol2 = shuffle(row2Cols).find(c =>
    c !== waitCol1 && band2ByCol[c].some(n => !used.has(n))
  );
  for (const col of row2Cols) {
    if (col === waitCol2) {
      if (!place(2, col, band2ByCol[col])) {
        if (!place(2, col, band0ByCol[col])) return null;
      }
    } else {
      if (!place(2, col, band0ByCol[col])) return null;
    }
  }

  return ticket;
}

/**
 * Generates a pool of optimized tickets for a number sequence.
 * Each ticket is validated against target completion ranges.
 *
 * Targets (Option A — fast game):
 *   E5: 6-8, Line 1: 15-22, Line 2: 25-32, Line 3: 35-42, FH: 35-42
 */
export function generateOptimizedTicketPool(
  sequence: number[],
  count: number = 300,
): TicketPoolEntry[] {
  const pool: TicketPoolEntry[] = [];
  let attempts = 0;
  const maxAttempts = count * 200; // More attempts needed for tight targets

  while (pool.length < count && attempts < maxAttempts) {
    attempts++;
    const ticket = generateOptimizedTicket(sequence);
    if (!ticket || !validateTicket(ticket)) continue;

    const sim = simulateTicket(ticket, sequence);
    const lines = [sim.tl, sim.ml, sim.bl].sort((a, b) => a - b);

    // Tight filters matching Option A targets
    if (sim.e5 > 9) continue;       // E5: median ~7
    if (lines[0] > 24) continue;     // fastest line: ≤24
    if (lines[1] > 34) continue;     // second line: ≤34
    if (lines[2] > 44) continue;     // slowest line: ≤44
    if (sim.fh < 30) continue;       // FH not too instant

    pool.push({ ticket, ...sim });
  }

  // Shuffle pool so adjacent tickets have variety
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool;
}

export function validateTicket(ticket: TambolaTicket): boolean {
  // Check dimensions
  if (ticket.length !== 3 || ticket.some((row) => row.length !== 9)) {
    return false;
  }

  // Check each row has exactly 5 numbers
  for (const row of ticket) {
    const count = row.filter((n) => n !== 0).length;
    if (count !== 5) {
      return false;
    }
  }

  // Check total 15 unique numbers
  const allNumbers = ticket.flat().filter((n) => n !== 0);
  if (allNumbers.length !== 15) {
    return false;
  }

  const uniqueNumbers = new Set(allNumbers);
  if (uniqueNumbers.size !== 15) {
    return false;
  }

  // Check numbers are in correct column ranges
  for (let col = 0; col < 9; col++) {
    const [min, max] = COLUMN_RANGES[col];
    for (let row = 0; row < 3; row++) {
      const num = ticket[row][col];
      if (num !== 0 && (num < min || num > max)) {
        return false;
      }
    }
  }

  return true;
}
