import { describe, expect, it } from "vitest";
import { formatWait } from "./format";

describe("formatWait", () => {
  it("rounds sub-hour waits to 'less than an hour'", () => {
    expect(formatWait(0)).toBe("less than an hour");
    expect(formatWait(1700)).toBe("less than an hour");
  });

  it("uses hours below two days", () => {
    expect(formatWait(3600)).toBe("about 1 hour");
    expect(formatWait(5 * 3600)).toBe("about 5 hours");
    expect(formatWait(47 * 3600)).toBe("about 47 hours");
  });

  it("switches to days from two days up", () => {
    expect(formatWait(48 * 3600)).toBe("about 2 days");
    expect(formatWait(21 * 86_400)).toBe("about 21 days");
  });
});
