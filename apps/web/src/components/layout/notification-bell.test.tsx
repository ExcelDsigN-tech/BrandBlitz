import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NotificationBell } from "./notification-bell";

const mockPatch = vi.fn();
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();
const mockIsPushSupported = vi.fn(() => true);
const mockGetExistingPushSubscription = vi.fn();
const mockSubscribeToPush = vi.fn();
const mockUnsubscribeFromPush = vi.fn();

vi.mock("@/lib/api", () => ({
  createApiClient: () => ({
    get: mockGet,
    patch: mockPatch,
    post: mockPost,
    delete: mockDelete,
  }),
}));

vi.mock("@/lib/push", () => ({
  isPushSupported: () => mockIsPushSupported(),
  getExistingPushSubscription: () => mockGetExistingPushSubscription(),
  subscribeToPush: (key: string) => mockSubscribeToPush(key),
  unsubscribeFromPush: () => mockUnsubscribeFromPush(),
}));

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPushSupported.mockReturnValue(true);
    mockGetExistingPushSubscription.mockResolvedValue(null);
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

  it("subscribes to push from the notification drawer", async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === "/users/me/push/config") {
        return Promise.resolve({ data: { configured: true, public_key: "vapid-key" } });
      }
      if (url === "/users/me/push/subscriptions") {
        return Promise.resolve({ data: { enabled: false, subscriptions: [] } });
      }
      return Promise.resolve({ data: { notifications: [] } });
    });
    mockSubscribeToPush.mockResolvedValue({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});

    render(<NotificationBell apiToken="test-token" />);
    fireEvent.click(await screen.findByRole("button", { name: /Notifications/i }));

    const toggle = await screen.findByRole("switch", { name: /Push notifications/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockSubscribeToPush).toHaveBeenCalledWith("vapid-key");
    });
    expect(mockPost).toHaveBeenCalledWith(
      "/users/me/push/subscriptions",
      expect.objectContaining({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      }),
      expect.anything()
    );
    expect(mockPatch).toHaveBeenCalledWith(
      "/users/me/push/preferences",
      { enabled: true },
      expect.anything()
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Push notifications enabled");
    });
  });

  it("unsubscribes from push without touching in-app notifications", async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === "/users/me/push/config") {
        return Promise.resolve({ data: { configured: true, public_key: "vapid-key" } });
      }
      if (url === "/users/me/push/subscriptions") {
        return Promise.resolve({ data: { enabled: true, subscriptions: [] } });
      }
      return Promise.resolve({ data: { notifications: [] } });
    });
    mockGetExistingPushSubscription.mockResolvedValue({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    });
    mockUnsubscribeFromPush.mockResolvedValue("https://fcm.googleapis.com/fcm/send/abc");
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue({});

    render(<NotificationBell apiToken="test-token" />);
    fireEvent.click(await screen.findByRole("button", { name: /Notifications/i }));

    const toggle = await screen.findByRole("switch", { name: /Push notifications/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockUnsubscribeFromPush).toHaveBeenCalled();
    });
    expect(mockPatch).toHaveBeenCalledWith(
      "/users/me/push/preferences",
      { enabled: false },
      expect.anything()
    );
    expect(mockDelete).toHaveBeenCalledWith(
      "/users/me/push/subscriptions",
      expect.objectContaining({
        data: { endpoint: "https://fcm.googleapis.com/fcm/send/abc" },
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Push notifications disabled");
    });
  });
});
