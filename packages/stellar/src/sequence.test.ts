import { describe, expect, it, vi } from "vitest";
import { reserveSequence, resetSequence, type SequenceStore } from "./sequence";

class InMemorySequenceStore implements SequenceStore {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
  }

  async incr(key: string): Promise<number> {
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, next.toString());
    return next;
  }

  async setIfAbsent(key: string, value: string): Promise<boolean> {
    if (this.values.has(key)) {
      return false;
    }

    this.values.set(key, value);
    return true;
  }
}

describe("sequence reservation", () => {
  it("reserves 200 monotonic sequences concurrently", async () => {
    const store = new InMemorySequenceStore();
    const loadBaseSequence = vi.fn(async () => "1000");

    const reservations = await Promise.all(
      Array.from({ length: 200 }, () =>
        reserveSequence({
          store,
          keyPrefix: "stellar:seq:test",
          loadBaseSequence,
        })
      )
    );

    expect(loadBaseSequence).toHaveBeenCalledTimes(1);
    expect(new Set(reservations.map((reservation) => reservation.transactionSequence)).size).toBe(
      200
    );
    expect(reservations[0]?.baseSequence).toBe("1000");

    const sorted = reservations
      .map((reservation) => BigInt(reservation.transactionSequence))
      .sort((a, b) => Number(a - b));

    expect(sorted[0]).toBe(1001n);
    expect(sorted[199]).toBe(1200n);
  });

  it("resets the offset counter after a bad sequence event", async () => {
    const store = new InMemorySequenceStore();
    const onReset = vi.fn();

    await reserveSequence({
      store,
      keyPrefix: "stellar:seq:test",
      loadBaseSequence: async () => "2000",
    });
    await reserveSequence({
      store,
      keyPrefix: "stellar:seq:test",
      loadBaseSequence: async () => "2000",
    });

    await resetSequence({
      store,
      keyPrefix: "stellar:seq:test",
      loadBaseSequence: async () => "3000",
      reason: "tx_bad_seq",
      onReset,
    });

    const nextReservation = await reserveSequence({
      store,
      keyPrefix: "stellar:seq:test",
      loadBaseSequence: async () => "3000",
    });

    expect(nextReservation.transactionSequence).toBe("3001");
    expect(onReset).toHaveBeenCalledWith({
      keyPrefix: "stellar:seq:test",
      reason: "tx_bad_seq",
      baseSequence: "3000",
    });
  });
});
