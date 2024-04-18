import { IdPool } from "IdPool";

describe("IdPool", function () {
  it("reserves 10 ids", function () {
    const pool = new IdPool();
    const ids = [];
    for (let i = 0; i < 10; i++) {
      ids.push(pool.reserve());
    }
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("reserves 10 ids, releases 5 and reserves 3 more", function () {
    const pool = new IdPool();
    const ids = [];
    for (let i = 0; i < 10; i++) {
      ids.push(pool.reserve());
    }
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    pool.release(1);
    pool.release(3);
    pool.release(5);
    pool.release(7);
    pool.release(9);
    expect(pool.reserve()).toEqual(1);
    expect(pool.reserve()).toEqual(3);
    expect(pool.reserve()).toEqual(5);
    expect(pool.reserve()).toEqual(7);
    expect(pool.reserve()).toEqual(9);
  });
});
