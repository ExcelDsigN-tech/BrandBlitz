import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NotificationBell } from "./notification-bell";

const mockPatch = vi.fn();
const mockGet = vi.fn();

vi.mock("@/lib/api", () => ({
  createApiClient: () => ({
    get: mockGet,
    patch: mockPatch,
  }),
}));

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({
      data: {
        notifications: [
          {
            id: "n1",
            type: "payout_received",
            payload: { amount_usdc: "10.0" },
            created_at: new Date().toISOString(),
            read_at: null,
          },
        ],
      },
    });
  });

  it("shows success confirmation when Mark all read completes", async () => {
    mockPatch.mockResolvedValueOnce({});
    render(<NotificationBell apiToken="test-token" />);

    const bell = await screen.findByRole("button", { name: /Notifications/i });
    fireEvent.click(bell);

    const markAllBtn = await screen.findByRole("button", { name: /Mark all read/i });
    fireEvent.click(markAllBtn);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("All notifications marked as read");
    });
  });

  it("shows error confirmation when Mark all read fails", async () => {
    mockPatch.mockRejectedValueOnce(new Error("API failure"));
    render(<NotificationBell apiToken="test-token" />);

    const bell = await screen.findByRole("button", { name: /Notifications/i });
    fireEvent.click(bell);

    const markAllBtn = await screen.findByRole("button", { name: /Mark all read/i });
    fireEvent.click(markAllBtn);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Failed to mark notifications as read");
    });
  });
});
