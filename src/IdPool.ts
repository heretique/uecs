// Define an interface for the interval type
interface Interval {
  left: number;
  right: number; // not inclusive
}

function compareIntervals(a: Interval, b: Interval): number {
  if (a.left < b.left && a.right < b.right) {
    return -1;
  } else if (a.left > b.left && a.right > b.right) {
    return 1;
  } else {
    return 0;
  }
}

// Define a class for the id pool
export class IdPool {
  // Use a set to store the free intervals
  private free: Interval[];

  constructor() {
    // Initialize the set with one interval that covers all positive numbers
    this.free = [];
    this.free.push({ left: 1, right: Number.MAX_SAFE_INTEGER });
  }

  // Reserve an id from the pool and return it, assumes that the free array is always sorted
  // by the leftmost id in the interval and it should be because we're sorting it in the
  // release method
  reserve(): number {
    // Get the first interval from the set
    const first = this.free[0];
    if (first.left == Number.MAX_SAFE_INTEGER) {
      return 0;
    }

    // Get the leftmost id from the interval
    const id = first.left;
    if (first.left + 1 < first.right) {
      // If the interval has more than one id, replace it with a new interval that has
      // the same rightmost id but the leftmost id is the next one
      this.free[0] = { left: first.left + 1, right: first.right };
    } else {
      if (first.left + 1 == Number.MAX_SAFE_INTEGER) {
        return 0;
      }
      // If the interval has only one id, remove it from the set
      this.free.shift();
    }

    return id;
  }

  // Release an id back to the pool
  release(id: number): void {
    // If the id is not valid, do nothing
    if (id == 0 || id == Number.MAX_SAFE_INTEGER) {
      return;
    }

    // Find the index of the interval that contains the id
    const index = this.free.findIndex((interval) => {
      return interval.left <= id && interval.right > id;
    });

    if (index == -1) {
      // If the id is not in any interval, create a new interval with the id
      this.free.push({ left: id, right: id + 1 });
    } else {
      // Get the interval
      const interval = this.free[index];
      // split the interval into two intervals
      const left = { left: interval.left, right: id };
      const right = { left: id + 1, right: interval.right };
      // replace the interval with the two new intervals
      this.free.splice(index, 1, left, right);
    }

    // sort the free array by the leftmost id in the interval
    this.free.sort(compareIntervals);
  }
}
