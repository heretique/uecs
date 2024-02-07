export type Trie<S, T> = {
  value?: T;
  branches?: Map<S, Trie<S, T>>;
};

/** Gets the value associated with the sequence seq in the trie.
 * @returns the value, or undefined if not found */
export function getInTrie<S, T>(trie: Trie<S, T>, seq: S[]): T | undefined {
  let t = trie;
  const seqLen = seq.length;
  for (let i = 0; i < seqLen; ++i) {
    const s = seq[i];
    const branch = t.branches?.get(s);
    if (branch == undefined) {
      return undefined;
    }
    t = branch;
  }
  return t.value;
}

/** Sets the value associated with the sequence seq in the trie. */
export function setInTrie<S, T>(trie: Trie<S, T>, seq: S[], value: T): void {
  let t = trie;
  const seqLen = seq.length;
  for (let i = 0; i < seqLen; ++i) {
    const s = seq[i];
    if (t.branches == undefined) {
      t.branches = new Map();
    }
    let branch = t.branches?.get(s);
    if (branch == undefined) {
      branch = {};
      t.branches?.set(s, branch);
    }
    t = branch;
  }
  t.value = value;
}

// TODO: Use an iterative rather than recursive search...
/** Calls found for each sequence in trie that is a subsequence of seq (has the same order with one or more elements deleted).
 * If found returns false, stops searching.
 * @param seq a list of symbols
 * @param trie a trie of subsequences */
export function foreachSubsequenceInTrie<S, T>(
  trie: Trie<S, T>,
  seq: S[],
  found: (value: T) => boolean | void
): false | void {
  return foreachSubsequenceInTriesRec(trie, seq, 0, seq.length, found);
}

function foreachSubsequenceInTriesRec<S, T>(
  trie: Trie<S, T>,
  seq: S[],
  seqStart: number,
  seqLen: number,
  found: (value: T) => boolean | void
): false | void {
  const { value, branches } = trie;
  if (value != undefined && found(value) === false) {
    return false;
  }
  for (let i = seqStart; i <= seqLen; ++i) {
    const branch = branches?.get(seq[i]);
    if (branch != undefined && foreachSubsequenceInTriesRec(branch, seq, i + 1, seqLen, found) === false) {
      return false;
    }
  }
}

/** Reusable iterator for searching a trie for subsequences of a sequence.
 * Usage:
 * it = new TrieSubsequenceIterator();
 * let value: T;
 * for (it.start(trie, ['A', 'B', 'C']); it.next(); ) {
 *   ...it.value...
 * } */
export class TrieSubsequenceIterator<S, T> {
  /** Iteration path. ***Valid length is pathLen + 1.***
   * [0] is the trie being searched; subsequent elements are the branches taken at each step. */
  path: (Trie<S, T> | undefined)[] = [];
  /** Sequence index at each step in the path. ***Valid length is pathLen.***
   * If the value iterated is from the root of the trie, pathLen is 0 and nothing in this array is valid. */
  seqIdx: number[] = [];
  /** Length of path. */
  pathLen = 0;
  /** Sequence to search the trie for subsequences of. */
  seq?: S[];
  /** Value found at current step, if any. */
  value?: T;

  constructor(seq: S[], trie: Trie<S, T>) {
    this.reset(seq, trie);
  }

  reset(seq?: S[], trie?: Trie<S, T>) {
    if (trie != undefined) {
      this.path[0] = trie;
    }
    if (seq != undefined) {
      this.seq = seq;
    }
    this.pathLen = 0;
    if (this.seq != undefined) {
      this.seqIdx.length = this.seq.length;
    }
    this.seqIdx[0] = 0;
    this.value = undefined;
    return this;
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  next(): boolean {
    const rootTrie = this.path[0];
    if (this.seq == undefined || rootTrie == undefined) {
      return false;
    }
    // On the first call to next(), yield any value at the root of the trie.
    if (this.value == undefined && this.pathLen === 0) {
      const value = rootTrie.value;
      if (value != undefined) {
        this.value = value;
        return true;
      }
    }
    // If no value at the root, and on subsequent calls to next(),
    // advance search until a value is found or all possibilities are exhausted.
    const seqLen = this.seq.length;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let pathLen = this.pathLen;
      const trie = this.path[pathLen]!;
      // If current position in sequence is a valid branch, advance sequence and take branch one level farther.
      const s = this.seq[this.seqIdx[pathLen]];
      const branch = trie.branches?.get(s);
      if (branch != undefined) {
        this.pathLen = ++pathLen;
        this.path[pathLen] = branch;
        // Note: This seqIdx might be past the end of the sequence; that will be fixed in the next if.
        this.seqIdx[pathLen] = this.seqIdx[pathLen - 1] + 1;
        if (branch.value != undefined) {
          this.value = branch.value;
          return true;
        }
      }
      if (branch == undefined || this.seqIdx[pathLen] >= seqLen) {
        // Current position in sequence is not a valid branch, advance sequence.
        // Backtrack when the sequence at the current level is at its end.
        while (++this.seqIdx[pathLen] >= seqLen) {
          this.seqIdx[pathLen] = -1;
          // Exit if backtracked past the top.
          // But don't remove the root trie from path[0].
          if (pathLen === 0) {
            return false;
          }
          this.path[pathLen] = undefined;
          --pathLen;
        }
        this.pathLen = pathLen;
      }
    }
  }
}
