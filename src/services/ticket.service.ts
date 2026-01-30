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
