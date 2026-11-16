import { describe, expect, it, vi } from 'vitest';
import { SubRenderQueue } from '../../../src/rendering/sub-render-queue';
import {
  TurnStatus,
  type DataChunkMessageWord,
  type TranscriptHelperObjectWord,
} from '../../../src/core/types';
import { ELoggerType } from '../../../src/utils/debug';

function createQueue() {
  const callMessagePrint = vi.fn<(type: ELoggerType, ...args: unknown[]) => void>();
  const mutateChatHistory = vi.fn<() => void>();
  return new SubRenderQueue(callMessagePrint, mutateChatHistory);
}

describe('SubRenderQueue.sortWordsWithStatus', () => {
  it('returns empty list for final turns with no words', () => {
    const queue = createQueue();
    expect(() => queue.sortWordsWithStatus([], TurnStatus.END)).not.toThrow();
    expect(queue.sortWordsWithStatus([], TurnStatus.END)).toEqual([]);
  });

  it('sorts by start_ms and keeps same-start_ms words within one message', () => {
    const queue = createQueue();
    const words: DataChunkMessageWord[] = [
      { word: 'b', start_ms: 200, duration_ms: 50, stable: true },
      { word: 'a', start_ms: 100, duration_ms: 50, stable: true },
      { word: 'dup', start_ms: 100, duration_ms: 50, stable: true },
    ];

    const result = queue.sortWordsWithStatus(words, TurnStatus.IN_PROGRESS);
    expect(result).toHaveLength(3);
    expect(result.map((w) => w.word)).toEqual(['a', 'dup', 'b']);
    expect(result.every((w) => w.word_status === TurnStatus.IN_PROGRESS)).toBe(true);
  });

  it('marks only the last word as final when turn is complete', () => {
    const queue = createQueue();
    const words: DataChunkMessageWord[] = [
      { word: 'a', start_ms: 100, duration_ms: 50, stable: true },
      { word: 'b', start_ms: 200, duration_ms: 50, stable: true },
    ];

    const result = queue.sortWordsWithStatus(words, TurnStatus.END);
    expect(result).toHaveLength(2);
    expect(result[0].word_status).toBe(TurnStatus.IN_PROGRESS);
    expect(result[1].word_status).toBe(TurnStatus.END);
  });
});

// ---------------------------------------------------------------------------
// Bug condition exploration (word-same-timestamp-dedup-fix, Property 1).
// Inputs go through pushToQueue / interruptQueue and results are read from
// queue[0].words, so the same tests run before and after the fix.
// "␠" is a space word; labels are `word@start_ms`.
// ---------------------------------------------------------------------------
const SP = ' ';
const SP_LABEL = '␠';
const TURN_ID = 1;

function parseWord(label: string): DataChunkMessageWord {
  const at = label.lastIndexOf('@');
  const raw = label.slice(0, at);
  return {
    word: raw === SP_LABEL ? SP : raw,
    start_ms: Number(label.slice(at + 1)),
    duration_ms: 0,
    stable: true,
  };
}

function ws(labels: string[]): DataChunkMessageWord[] {
  return labels.map(parseWord);
}

function labelOf(word: { word: string; start_ms: number }) {
  return `${word.word === SP ? SP_LABEL : word.word}@${word.start_ms}`;
}

function push(
  queue: SubRenderQueue,
  labels: string[],
  status: TurnStatus = TurnStatus.IN_PROGRESS,
  turn_id = TURN_ID
) {
  queue.pushToQueue({ turn_id, words: ws(labels), text: '', status, stream_id: 0, uid: 'agent' });
}

function labelsOf(queue: SubRenderQueue) {
  return (queue.queue[0]?.words ?? []).map(labelOf);
}

function statusesOf(queue: SubRenderQueue) {
  return (queue.queue[0]?.words ?? []).map((word) => word.word_status);
}

function textOf(queue: SubRenderQueue) {
  return (queue.queue[0]?.words ?? []).map((word) => word.word).join('');
}

const U1_K = ['try@6744', '␠@6902', 'a@6984'];
const U1_M = ['try@6744', '␠@6902', 'a@6984', '␠@6983', 'different@6984'];
const U1_RESULT = ['try@6744', '␠@6902', '␠@6983', 'a@6984', 'different@6984'];

describe('SubRenderQueue bug condition: same start_ms, different word (Property 1)', () => {
  it('U1: keeps different@6984 when a@6984 is already kept (cross-message)', () => {
    const queue = createQueue();
    push(queue, U1_K);
    push(queue, U1_M);
    expect(labelsOf(queue)).toEqual(U1_RESULT);
  });

  it('U2a: keeps both words that share a start_ms inside one update message', () => {
    const queue = createQueue();
    push(queue, ['try@6744', '␠@6902']);
    push(queue, ['␠@6902', 'a@6984', '␠@6983', 'different@6984']);
    expect(labelsOf(queue)).toEqual(U1_RESULT);
  });

  it('U2b: keeps both words that share a start_ms in the first message of a turn', () => {
    const queue = createQueue();
    push(queue, U1_M);
    expect(labelsOf(queue)).toEqual(U1_RESULT);
  });

  it('U3: overlapping resend only appends the new words', () => {
    const queue = createQueue();
    push(queue, U1_K);
    push(queue, U1_M);
    push(queue, ['␠@6902', 'a@6984', '␠@6983', 'different@6984', '␠@7222', 'one.@7304']);
    expect(labelsOf(queue)).toEqual([...U1_RESULT, '␠@7222', 'one.@7304']);
    expect(textOf(queue)).toBe('try  adifferent one.');
  });

  it('U4a: Chinese ～团 in the first message keeps all words, resend only adds 天', () => {
    const queue = createQueue();
    const first = ['想@6932', '～@7195', '团@7195', '团@7413', '昨@7686'];
    push(queue, first);
    expect(labelsOf(queue)).toEqual(first);
    push(queue, [...first, '天@7823']);
    expect(labelsOf(queue)).toEqual([...first, '天@7823']);
  });

  it('U4b: Chinese 。。小 keeps every word, resend only adds 白', () => {
    const queue = createQueue();
    const k = ['架@700', '’@927', '？@927'];
    push(queue, k);
    expect(labelsOf(queue)).toEqual(k);
    push(queue, [...k, '”@1061', '。@1079', '。@1079', '小@1079']);
    expect(labelsOf(queue)).toEqual([...k, '”@1061', '。@1079', '。@1079', '小@1079']);
    expect(textOf(queue)).toBe('架’？”。。小');
    push(queue, ['”@1061', '。@1079', '。@1079', '小@1079', '白@1270']);
    expect(labelsOf(queue)).toEqual([...k, '”@1061', '。@1079', '。@1079', '小@1079', '白@1270']);
  });

  it('U5: sliding 32-word windows reproduce the original 40-word sequence', () => {
    // 40 distinct words; groups of shared start_ms at 5-6, 14-16 and 31-32 (31/32 straddle a window boundary).
    const starts: number[] = [];
    let t = 0;
    for (let i = 0; i < 40; i++) {
      if (i !== 6 && i !== 15 && i !== 16 && i !== 32) {
        t += 100;
      }
      starts.push(t);
    }
    const all = starts.map((s, i) => `w${i}@${s}`);
    const queue = createQueue();
    const windows: Array<[number, number]> = [
      [0, 32],
      [3, 35],
      [6, 38],
      [8, 40],
    ];
    for (const [from, to] of windows) {
      push(queue, all.slice(from, to));
    }
    expect(labelsOf(queue)).toEqual(all);
  });

  it('U6: word arriving after an interrupt is kept, INTERRUPTED, and K marks are unchanged', () => {
    const queue = createQueue();
    push(queue, ['try@6744', '␠@6902', '␠@6983', 'a@6984']);
    queue.interruptQueue({ turn_id: TURN_ID, start_ms: 6984 });
    expect(statusesOf(queue)).toEqual([
      TurnStatus.IN_PROGRESS,
      TurnStatus.IN_PROGRESS,
      TurnStatus.INTERRUPTED,
      TurnStatus.INTERRUPTED,
    ]);
    push(queue, ['␠@6983', 'a@6984', 'different@6984']);
    expect(labelsOf(queue)).toEqual(['try@6744', '␠@6902', '␠@6983', 'a@6984', 'different@6984']);
    expect(statusesOf(queue)).toEqual([
      TurnStatus.IN_PROGRESS,
      TurnStatus.IN_PROGRESS,
      TurnStatus.INTERRUPTED,
      TurnStatus.INTERRUPTED,
      TurnStatus.INTERRUPTED,
    ]);
  });

  it('U8c: INTERRUPTED stamp survives a later in-progress message', () => {
    const queue = createQueue();
    push(queue, ['a@100', 'b@200'], TurnStatus.INTERRUPTED);
    expect(statusesOf(queue)).toEqual([TurnStatus.IN_PROGRESS, TurnStatus.INTERRUPTED]);
    push(queue, ['b@200']);
    expect(labelsOf(queue)).toEqual(['a@100', 'b@200']);
    expect(statusesOf(queue)).toEqual([TurnStatus.IN_PROGRESS, TurnStatus.INTERRUPTED]);
  });

  it('U8d: interruptQueue keeps x, y, z order; later w@100 lands after y as INTERRUPTED', () => {
    const queue = createQueue();
    push(queue, ['x@100', 'y@100', 'z@200']);
    queue.interruptQueue({ turn_id: TURN_ID, start_ms: 100 });
    expect(labelsOf(queue)).toEqual(['x@100', 'y@100', 'z@200']);
    expect(statusesOf(queue)).toEqual([
      TurnStatus.INTERRUPTED,
      TurnStatus.INTERRUPTED,
      TurnStatus.INTERRUPTED,
    ]);
    push(queue, ['w@100']);
    expect(labelsOf(queue)).toEqual(['x@100', 'y@100', 'w@100', 'z@200']);
    expect(statusesOf(queue)).toEqual([
      TurnStatus.INTERRUPTED,
      TurnStatus.INTERRUPTED,
      TurnStatus.INTERRUPTED,
      TurnStatus.INTERRUPTED,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Generator branch: isBugCondition(X) === true  =>  each step equals expectedMerge(K, M).
// Fixed-seed mulberry32, 500 iterations.
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GEN_SEED = 0x5eed2026;
const GEN_ITERATIONS = 500;
const VOCAB = [SP_LABEL, 'a', 'the', 'different', '。', '～', '团', '小'];

function pick<T>(rand: () => number, items: T[]): T {
  return items[Math.floor(rand() * items.length)];
}

/** Reference sequence L: non-decreasing start_ms, (word, start_ms) pairwise distinct. */
function genReference(rand: () => number): string[] {
  const length = 1 + Math.floor(rand() * 120);
  const out: string[] = [];
  const seen = new Set<string>();
  let start = 0;
  for (let i = 0; i < length; i++) {
    start += i === 0 ? 0 : rand() < 0.3 ? 0 : pick(rand, [1, 80, 250]);
    let word = pick(rand, VOCAB);
    for (let attempt = 0; seen.has(`${word}@${start}`); attempt++) {
      if (attempt >= 20) {
        start += 1;
      }
      word = pick(rand, VOCAB);
    }
    seen.add(`${word}@${start}`);
    out.push(`${word}@${start}`);
  }
  return out;
}

/** Sliding windows over L plus random same-start inserts and whole-window resends. */
function genMessages(rand: () => number): string[][] {
  const reference = genReference(rand);
  const messages: string[][] = [];
  let begin = 0;
  for (;;) {
    const length = 1 + Math.floor(rand() * 32);
    const window = reference.slice(begin, begin + length);
    if (rand() < 0.4 && window.length > 0) {
      const base = pick(rand, window);
      const start = base.slice(base.lastIndexOf('@') + 1);
      const extra = `${pick(rand, VOCAB)}@${start}`;
      window.splice(Math.floor(rand() * (window.length + 1)), 0, extra);
    }
    messages.push(window);
    if (rand() < 0.2) {
      messages.push([...window]);
    }
    if (begin + length >= reference.length) {
      break;
    }
    begin += 1 + Math.floor(rand() * length);
  }
  return messages;
}

const startOf = (label: string) => Number(label.slice(label.lastIndexOf('@') + 1));

/** Unfixed rule (TS): stable sort of [...K, ...M], keep the first word per start_ms. */
function legacyMerge(kept: string[], incoming: string[]): string[] {
  const sorted = [...kept, ...incoming].sort((a, b) => startOf(a) - startOf(b));
  return sorted.filter(
    (label, index) => sorted.findIndex((x) => startOf(x) === startOf(label)) === index
  );
}

function isBugCondition(messages: string[][]): boolean {
  let kept: string[] = [];
  for (const message of messages) {
    for (let j = 0; j < message.length; j++) {
      const w = message[j];
      const sameKeyKept = kept.includes(w);
      const sameStartKept = kept.some((k) => startOf(k) === startOf(w) && k !== w);
      const sameStartEarlierInMessage = message.slice(0, j).some((x) => startOf(x) === startOf(w));
      if (!sameKeyKept && (sameStartKept || sameStartEarlierInMessage)) {
        return true;
      }
    }
    kept = legacyMerge(kept, message);
  }
  return false;
}

function expectedMerge(kept: string[], incoming: string[]): string[] {
  const added = incoming.filter((label) => !kept.includes(label));
  return [...kept, ...added].sort((a, b) => startOf(a) - startOf(b));
}

describe('SubRenderQueue bug condition generator (Property 1)', () => {
  it(`every step equals expectedMerge(K, M) when isBugCondition holds (seed=${GEN_SEED}, ${GEN_ITERATIONS} iterations)`, () => {
    const rand = mulberry32(GEN_SEED);
    let bugCases = 0;
    for (let iteration = 0; iteration < GEN_ITERATIONS; iteration++) {
      const messages = genMessages(rand);
      if (!isBugCondition(messages)) {
        continue;
      }
      bugCases++;
      const queue = createQueue();
      let kept: string[] = [];
      messages.forEach((message, step) => {
        push(queue, message);
        const actual = labelsOf(queue);
        const expected = expectedMerge(kept, message);
        expect(
          actual,
          `seed=${GEN_SEED} iteration=${iteration} step=${step} input=${JSON.stringify(messages)}`
        ).toEqual(expected);
        kept = actual;
      });
    }
    expect(bugCases).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Preservation (word-same-timestamp-dedup-fix, Property 2). Written observation-first
// against the unfixed SubRenderQueue; must pass before and after the fix.
// ---------------------------------------------------------------------------
describe('SubRenderQueue preservation: inputs outside the bug condition (Property 2)', () => {
  it('U7: known gap keeps the later duplicate-key space dropped ("Let metry")', () => {
    const queue = createQueue();
    push(queue, ['Let@6380', '␠@6662', 'me@6663']);
    push(queue, ['Let@6380', '␠@6662', 'me@6663', '␠@6662', 'try@6744']);
    expect(labelsOf(queue)).toEqual(['Let@6380', '␠@6662', 'me@6663', 'try@6744']);
    expect(textOf(queue)).toBe('Let metry');
  });

  it('U8a: END is reset to IN_PROGRESS when an in-progress message follows', () => {
    const queue = createQueue();
    push(queue, ['a@100', 'b@200'], TurnStatus.END);
    expect(statusesOf(queue)).toEqual([TurnStatus.IN_PROGRESS, TurnStatus.END]);
    push(queue, ['b@200', 'c@300']);
    expect(labelsOf(queue)).toEqual(['a@100', 'b@200', 'c@300']);
    expect(statusesOf(queue)).toEqual([
      TurnStatus.IN_PROGRESS,
      TurnStatus.IN_PROGRESS,
      TurnStatus.IN_PROGRESS,
    ]);
  });

  it('U8b: only the last word is stamped END when the second message is final', () => {
    const queue = createQueue();
    push(queue, ['a@100', 'b@200'], TurnStatus.END);
    push(queue, ['b@200', 'c@300'], TurnStatus.END);
    expect(labelsOf(queue)).toEqual(['a@100', 'b@200', 'c@300']);
    expect(statusesOf(queue)).toEqual([
      TurnStatus.IN_PROGRESS,
      TurnStatus.IN_PROGRESS,
      TurnStatus.END,
    ]);
  });

  it('plain overlapping windows (distinct start_ms) reconstruct the original sequence', () => {
    const all = Array.from({ length: 40 }, (_, i) => `w${i}@${(i + 1) * 100}`);
    const queue = createQueue();
    const windows: Array<[number, number]> = [
      [0, 32],
      [3, 35],
      [6, 38],
      [8, 40],
    ];
    for (const [from, to] of windows) {
      push(queue, all.slice(from, to));
      expect(statusesOf(queue).every((s) => s === TurnStatus.IN_PROGRESS)).toBe(true);
    }
    expect(labelsOf(queue)).toEqual(all);
    push(queue, all.slice(8, 40), TurnStatus.END);
    expect(labelsOf(queue)).toEqual(all);
    expect(statusesOf(queue)).toEqual([...Array(39).fill(TurnStatus.IN_PROGRESS), TurnStatus.END]);
  });
});

/** Unfixed statuses: everything IN_PROGRESS, last word stamped with a non-in-progress turn_status. */
function legacyStatuses(count: number, status: TurnStatus): TurnStatus[] {
  const out: TurnStatus[] = Array(count).fill(TurnStatus.IN_PROGRESS);
  if (status !== TurnStatus.IN_PROGRESS && count > 0) {
    out[count - 1] = status;
  }
  return out;
}

describe('SubRenderQueue preservation generator (Property 2)', () => {
  it(`outside the bug condition every step equals the unfixed rule F (seed=${GEN_SEED}, ${GEN_ITERATIONS} iterations)`, () => {
    const rand = mulberry32(GEN_SEED ^ 0x2222);
    let preservedCases = 0;
    for (let iteration = 0; iteration < GEN_ITERATIONS; iteration++) {
      const messages = genMessages(rand);
      if (isBugCondition(messages)) {
        continue;
      }
      preservedCases++;
      // K never contains INTERRUPTED: only IN_PROGRESS / END message statuses are used.
      const turnStatuses = messages.map(() =>
        rand() < 0.25 ? TurnStatus.END : TurnStatus.IN_PROGRESS
      );
      const queue = createQueue();
      let reference: string[] = [];
      messages.forEach((message, step) => {
        push(queue, message, turnStatuses[step]);
        reference = legacyMerge(reference, message);
        const context = `seed=${GEN_SEED ^ 0x2222} iteration=${iteration} step=${step} input=${JSON.stringify(messages)} statuses=${JSON.stringify(turnStatuses)}`;
        expect(labelsOf(queue), context).toEqual(reference);
        expect(statusesOf(queue), context).toEqual(
          legacyStatuses(reference.length, turnStatuses[step])
        );
      });
    }
    expect(preservedCases).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Task 9.3: Properties 3-7 and boundary cases, calling the three-parameter
// sortWordsWithStatus(words, turn_status, keptWords) directly.
// Each word carries a unique `duration_ms` id so its origin (K or M) and
// position can be tracked independently of the (word, start_ms) key.
// ---------------------------------------------------------------------------
type KeptWord = TranscriptHelperObjectWord;
const K_ID_BASE = 1000;
const M_ID_BASE = 2000;
const keyOf = (word: { word: string; start_ms: number }) => `${word.word}@${word.start_ms}`;
const mergeApi = createQueue();
const merge = (m: DataChunkMessageWord[], status: TurnStatus, k?: KeptWord[]) =>
  k === undefined
    ? mergeApi.sortWordsWithStatus(m, status)
    : mergeApi.sortWordsWithStatus(m, status, k);

function mkWord(label: string, id: number): DataChunkMessageWord {
  return { ...parseWord(label), duration_ms: id };
}

interface MergeCase {
  K: KeptWord[];
  M: DataChunkMessageWord[];
  turnStatus: TurnStatus;
}

interface Shapes {
  emptyK: number;
  emptyM: number;
  resent: number;
  sameStartDifferent: number;
  interruptedK: number;
  staleEnd: number;
  duplicateInMessage: number;
}
const newShapes = (): Shapes => ({
  emptyK: 0,
  emptyM: 0,
  resent: 0,
  sameStartDifferent: 0,
  interruptedK: 0,
  staleEnd: 0,
  duplicateInMessage: 0,
});

function recordShapes(shapes: Shapes, c: MergeCase) {
  const kKeys = new Set(c.K.map(keyOf));
  const kStarts = new Set(c.K.map((w) => w.start_ms));
  if (c.K.length === 0) shapes.emptyK++;
  if (c.M.length === 0) shapes.emptyM++;
  if (c.M.some((w) => kKeys.has(keyOf(w)))) shapes.resent++;
  if (c.M.some((w) => kStarts.has(w.start_ms) && !kKeys.has(keyOf(w)))) shapes.sameStartDifferent++;
  if (c.K.some((w) => w.word_status === TurnStatus.INTERRUPTED)) shapes.interruptedK++;
  if (c.K.some((w) => w.word_status === TurnStatus.END)) shapes.staleEnd++;
  const mKeys = c.M.map(keyOf);
  if (new Set(mKeys).size < mKeys.length) shapes.duplicateInMessage++;
}

function assertShapes(shapes: Shapes, seed: number, label: string) {
  for (const [name, count] of Object.entries(shapes)) {
    expect(count, `${label}: shape "${name}" never occurred (seed=${seed})`).toBeGreaterThan(0);
  }
}

const STATUS_POOL: Array<TurnStatus | undefined> = [
  undefined,
  TurnStatus.IN_PROGRESS,
  TurnStatus.END,
  TurnStatus.INTERRUPTED,
];

/** Random K (sorted by start_ms, may contain END / INTERRUPTED) and M with resends, same-start and in-message repeats. */
function genMergeCase(rand: () => number): MergeCase {
  const kLength = rand() < 0.1 ? 0 : 1 + Math.floor(rand() * 20);
  const kLabels = kLength === 0 ? [] : genReference(rand).slice(0, kLength);
  const K: KeptWord[] = kLabels.map((label, i) => ({
    ...mkWord(label, K_ID_BASE + i),
    word_status: pick(rand, STATUS_POOL),
  }));
  // Property 6 shape: interrupted suffix from a random position.
  if (K.length > 0 && rand() < 0.5) {
    const from = Math.floor(rand() * K.length);
    for (let i = 0; i < K.length; i++) {
      K[i].word_status =
        i >= from ? TurnStatus.INTERRUPTED : pick(rand, [TurnStatus.IN_PROGRESS, TurnStatus.END]);
    }
  }
  const mLabels: string[] = [];
  const mLength = rand() < 0.1 ? 0 : 1 + Math.floor(rand() * 15);
  for (let i = 0; i < mLength; i++) {
    const r = rand();
    if (K.length > 0 && r < 0.3) {
      mLabels.push(labelOf(pick(rand, K))); // resent
    } else if (K.length > 0 && r < 0.6) {
      mLabels.push(`${pick(rand, VOCAB)}@${pick(rand, K).start_ms}`); // same start, maybe different word
    } else if (mLabels.length > 0 && r < 0.7) {
      mLabels.push(pick(rand, mLabels)); // repeat inside the message
    } else {
      mLabels.push(`${pick(rand, VOCAB)}@${Math.floor(rand() * 400)}`);
    }
  }
  const M = mLabels.map((label, i) => mkWord(label, M_ID_BASE + i));
  const turnStatus = pick(rand, [TurnStatus.IN_PROGRESS, TurnStatus.END, TurnStatus.INTERRUPTED]);
  return { K, M, turnStatus };
}

const describeCase = (seed: number, iteration: number, c: MergeCase) =>
  `seed=${seed} iteration=${iteration} input=${JSON.stringify(c)}`;

const cloneCase = (c: MergeCase): MergeCase => JSON.parse(JSON.stringify(c));

describe('SubRenderQueue.sortWordsWithStatus boundary cases (three parameters)', () => {
  it('K empty: every word of M is kept, in stable start_ms order', () => {
    const m = [mkWord('b@200', 1), mkWord('a@100', 2), mkWord('c@100', 3), mkWord('a@100', 4)];
    const result = merge(m, TurnStatus.IN_PROGRESS, []);
    expect(result.map((w) => w.duration_ms)).toEqual([2, 3, 4, 1]);
    expect(result.every((w) => w.word_status === TurnStatus.IN_PROGRESS)).toBe(true);
  });

  it('M empty: K is kept with statuses recomputed', () => {
    const k: KeptWord[] = [
      { ...mkWord('a@100', 1), word_status: TurnStatus.END },
      { ...mkWord('b@200', 2), word_status: TurnStatus.INTERRUPTED },
      { ...mkWord('c@300', 3), word_status: TurnStatus.END },
    ];
    const result = merge([], TurnStatus.IN_PROGRESS, k);
    expect(result.map(labelOf)).toEqual(['a@100', 'b@200', 'c@300']);
    expect(result.map((w) => w.word_status)).toEqual([
      TurnStatus.IN_PROGRESS,
      TurnStatus.INTERRUPTED,
      TurnStatus.INTERRUPTED,
    ]);
  });

  it('both empty returns [] for every turn_status', () => {
    for (const status of [TurnStatus.IN_PROGRESS, TurnStatus.END, TurnStatus.INTERRUPTED]) {
      expect(merge([], status, [])).toEqual([]);
      expect(merge([], status)).toEqual([]);
    }
  });
});

describe('SubRenderQueue.sortWordsWithStatus properties 3-7 (direct)', () => {
  it(`Property 3: overlapping windows reproduce L (seed=${GEN_SEED}, ${GEN_ITERATIONS} iterations)`, () => {
    const seed = GEN_SEED ^ 0x3333;
    const rand = mulberry32(seed);
    let multiWindow = 0;
    let overlapping = 0;
    for (let iteration = 0; iteration < GEN_ITERATIONS; iteration++) {
      const L = genReference(rand);
      const windows: string[][] = [];
      let begin = 0;
      for (;;) {
        const length = 1 + Math.floor(rand() * 32);
        windows.push(L.slice(begin, begin + length));
        if (begin + length >= L.length) break;
        const next = begin + 1 + Math.floor(rand() * length);
        if (next < begin + length) overlapping++;
        begin = next;
      }
      if (windows.length > 1) multiWindow++;
      let kept: KeptWord[] = [];
      windows.forEach((window, step) => {
        kept = merge(ws(window), TurnStatus.IN_PROGRESS, kept);
        const context = `seed=${seed} iteration=${iteration} step=${step} input=${JSON.stringify({ L, windows })}`;
        expect(kept.map(labelOf).join('|') === L.slice(0, kept.length).join('|'), context).toBe(
          true
        );
      });
      expect(
        kept.map(labelOf),
        `seed=${seed} iteration=${iteration} input=${JSON.stringify({ L, windows })}`
      ).toEqual(L);
    }
    expect(multiWindow, 'no multi-window case generated').toBeGreaterThan(0);
    expect(overlapping, 'no overlapping windows generated').toBeGreaterThan(0);
  });

  it(`Property 4: dedup key counts (seed=${GEN_SEED}, ${GEN_ITERATIONS} iterations)`, () => {
    const seed = GEN_SEED ^ 0x4444;
    const rand = mulberry32(seed);
    const shapes = newShapes();
    for (let iteration = 0; iteration < GEN_ITERATIONS; iteration++) {
      const c = genMergeCase(rand);
      recordShapes(shapes, c);
      const result = merge(c.M, c.turnStatus, c.K);
      const count = (words: Array<{ word: string; start_ms: number }>) => {
        const map = new Map<string, number>();
        words.forEach((w) => map.set(keyOf(w), (map.get(keyOf(w)) ?? 0) + 1));
        return map;
      };
      const kCount = count(c.K);
      const mCount = count(c.M);
      const expected = new Map<string, number>();
      kCount.forEach((n, key) => expected.set(key, n));
      mCount.forEach((n, key) => {
        if (!kCount.has(key)) expected.set(key, n);
      });
      const actual = count(result);
      expect(Object.fromEntries(actual), describeCase(seed, iteration, c)).toEqual(
        Object.fromEntries(expected)
      );
    }
    assertShapes(shapes, seed, 'Property 4');
  });

  it(`Property 5: stable order (seed=${GEN_SEED}, ${GEN_ITERATIONS} iterations)`, () => {
    const seed = GEN_SEED ^ 0x5555;
    const rand = mulberry32(seed);
    const shapes = newShapes();
    for (let iteration = 0; iteration < GEN_ITERATIONS; iteration++) {
      const c = genMergeCase(rand);
      recordShapes(shapes, c);
      const result = merge(c.M, c.turnStatus, c.K);
      const kKeys = new Set(c.K.map(keyOf));
      const added = c.M.filter((w) => !kKeys.has(keyOf(w)));
      // Independent expectation: sort (start_ms, position) over K ++ added.
      const expected = [...c.K, ...added]
        .map((w, position) => ({ w, position }))
        .sort((a, b) => a.w.start_ms - b.w.start_ms || a.position - b.position)
        .map(({ w }) => w.duration_ms);
      expect(
        result.map((w) => w.duration_ms),
        describeCase(seed, iteration, c)
      ).toEqual(expected);
    }
    assertShapes(shapes, seed, 'Property 5');
  });

  it(`Property 6: interrupt inheritance (seed=${GEN_SEED}, ${GEN_ITERATIONS} iterations)`, () => {
    const seed = GEN_SEED ^ 0x6666;
    const rand = mulberry32(seed);
    const shapes = newShapes();
    let checked = 0;
    for (let iteration = 0; iteration < GEN_ITERATIONS; iteration++) {
      const c = genMergeCase(rand);
      recordShapes(shapes, c);
      const result = merge(c.M, c.turnStatus, c.K);
      const context = describeCase(seed, iteration, c);
      const interruptedIds = new Set(
        c.K.filter((w) => w.word_status === TurnStatus.INTERRUPTED).map((w) => w.duration_ms)
      );
      if (interruptedIds.size === 0) continue;
      // First kept-interrupted word in sorted order (the last word may be re-stamped END).
      const first = result.findIndex((w) => interruptedIds.has(w.duration_ms));
      checked++;
      expect(first, context).toBeGreaterThanOrEqual(0);
      const last = result.length - 1;
      for (let i = first + 1; i < result.length; i++) {
        if (i === last && c.turnStatus === TurnStatus.END) {
          expect(result[i].word_status, context).toBe(TurnStatus.END);
        } else {
          expect(result[i].word_status, context).toBe(TurnStatus.INTERRUPTED);
        }
      }
    }
    expect(checked, 'no interrupted-K case checked').toBeGreaterThan(0);
    assertShapes(shapes, seed, 'Property 6');
  });

  it(`Property 7: status retention and END recomputation (seed=${GEN_SEED}, ${GEN_ITERATIONS} iterations)`, () => {
    const seed = GEN_SEED ^ 0x7777;
    const rand = mulberry32(seed);
    const shapes = newShapes();
    const stamped = { end: 0, interrupted: 0, staleEndCleared: 0 };
    for (let iteration = 0; iteration < GEN_ITERATIONS; iteration++) {
      const c = genMergeCase(rand);
      recordShapes(shapes, c);
      const before = cloneCase(c);
      const result = merge(c.M, c.turnStatus, c.K);
      const context = describeCase(seed, iteration, c);
      // Inputs are not mutated and result words are fresh objects.
      expect(c, context).toEqual(before);
      for (const w of result) {
        expect(c.K.includes(w as KeptWord) || (c.M as unknown[]).includes(w), context).toBe(false);
      }
      const keptInterrupted = new Set(
        c.K.filter((w) => w.word_status === TurnStatus.INTERRUPTED).map((w) => w.duration_ms)
      );
      const last = result.length - 1;
      let interruptedSeen = false;
      result.forEach((w, i) => {
        const isKeptInterrupted = keptInterrupted.has(w.duration_ms ?? -1);
        const isLastStamped = i === last && c.turnStatus !== TurnStatus.IN_PROGRESS;
        if (isLastStamped) {
          expect(w.word_status, context).toBe(c.turnStatus);
        } else if (isKeptInterrupted || interruptedSeen) {
          expect(w.word_status, context).toBe(TurnStatus.INTERRUPTED);
        } else {
          expect(w.word_status, context).toBe(TurnStatus.IN_PROGRESS);
        }
        if (isKeptInterrupted || w.word_status === TurnStatus.INTERRUPTED) interruptedSeen = true;
        if (w.word_status === TurnStatus.END) {
          expect(i === last && c.turnStatus === TurnStatus.END, context).toBe(true);
        }
      });
      if (last >= 0 && c.turnStatus === TurnStatus.END) stamped.end++;
      if (last >= 0 && c.turnStatus === TurnStatus.INTERRUPTED) stamped.interrupted++;
      const staleEnds = c.K.filter(
        (w) =>
          w.word_status === TurnStatus.END &&
          result.length > 0 &&
          result[last].duration_ms !== w.duration_ms
      );
      if (staleEnds.length > 0) {
        stamped.staleEndCleared++;
        for (const stale of staleEnds) {
          const now = result.find((w) => w.duration_ms === stale.duration_ms);
          expect(now?.word_status, context).not.toBe(TurnStatus.END);
        }
      }
    }
    assertShapes(shapes, seed, 'Property 7');
    expect(stamped.end, 'END stamp never exercised').toBeGreaterThan(0);
    expect(stamped.interrupted, 'INTERRUPTED stamp never exercised').toBeGreaterThan(0);
    expect(stamped.staleEndCleared, 'stale END on a non-last word never exercised').toBeGreaterThan(
      0
    );
  });
});
