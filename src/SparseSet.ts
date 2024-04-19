export class SparseSet {
  private dense: Int32Array;
  private sparse: Int32Array;
  private size: number = 0;
  private capacity: number;
  private maxCapacity: number = 550_000;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.dense = new Int32Array(capacity);
    this.sparse = new Int32Array(capacity);
  }

  /**
   * Adds a value to the data structure.
   *
   * @param value - The value to be added.
   * @returns The index at which the value was added.
   * @throws {Error} If the value is greater than or equal to the maximum capacity of the data structure.
   */
  add(value: number): number {
    if (value >= this.maxCapacity) {
      throw new Error(
        `Value ${value} is greater than or equal to the maximum capacity of the data structure ${this.maxCapacity}`
      );
    }

    if (value >= this.capacity) {
      // resize the arrays
      const newCapacity = Math.max(this.capacity * 2, value + 1);
      const newDense = new Int32Array(newCapacity);
      const newSparse = new Int32Array(newCapacity);
      newDense.set(this.dense);
      newSparse.set(this.sparse);
      this.dense = newDense;
      this.sparse = newSparse;
      this.capacity = newCapacity;
    }

    const index = this.size;
    this.dense[index] = value;
    this.sparse[value] = index;
    this.size++;
    return index;
  }

  remove(value: number): void {
    if (this.size === 0) {
      return;
    }

    const last = this.size - 1;
    const denseIndex = this.sparse[value];
    this.dense[denseIndex] = this.dense[last];
    this.sparse[this.dense[last]] = denseIndex;
    this.size--;
  }

  has(value: number): boolean {
    return (
      this.sparse[value] < this.size && this.dense[this.sparse[value]] == value
    );
  }

  clear(): void {
    this.size = 0;
  }

  getSize(): number {
    return this.size;
  }

  getCapacity(): number {
    return this.capacity;
  }

  get(value: number): number {
    return this.sparse[value];
  }

  getValues(): Int32Array {
    return this.dense;
  }

  [Symbol.iterator](): Iterator<number> {
    let index = 0;
    return {
      next: () => {
        if (index < this.size) {
          return { done: false, value: this.dense[index++] };
        } else {
          return { done: true, value: null };
        }
      },
    };
  }

  forEach(callback: (index: number) => void): void {
    for (let i = 0; i < this.size; i++) {
      callback(this.dense[i]);
    }
  }

  map<T>(callback: (index: number) => T): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.size; i++) {
      result.push(callback(this.dense[i]));
    }
    return result;
  }

  filter(predicate: (index: number) => boolean): number[] {
    const result: number[] = [];
    for (let i = 0; i < this.size; i++) {
      if (predicate(this.dense[i])) {
        result.push(this.dense[i]);
      }
    }
    return result;
  }
}
