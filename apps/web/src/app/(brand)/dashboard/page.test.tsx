import "@testing-library/jest-dom/vitest";
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./page";

const { apiGetMock, toastErrorMock, pushMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  toastErrorMock: vi.fn(),
  pushMock: vi.fn(),
}));

const sessionData = {
  apiToken: "test-token",
};

const routerMock = {
  push: pushMock,
};

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === "string" ? href : undefined} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ alt, src, ...props }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) => (
    <img alt={alt} src={src} {...props} />
  ),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: sessionData,
    status: "authenticated",
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");

  return {
    ...actual,
    createApiClient: () => ({
      get: apiGetMock,
      delete: vi.fn(),
    }),
  };
});

describe("DashboardPage", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiGetMock.mockResolvedValue({
      data: {
        leagues: [],
        data: [],
        nextCursor: null,
        challengeCount: 0,
        cohorts: [],
        offers: [],
        offered: [],
        acquired: [],
        issued: [],
      },
    });
    toastErrorMock.mockReset();
    pushMock.mockReset();
  });

  it("shows a toast once and renders a retry state when brands fail to load", async () => {
    apiGetMock.mockRejectedValueOnce(new Error("network down"));

    render(<DashboardPage />);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
    });

    expect(toastErrorMock).toHaveBeenCalledWith("Couldn't load brands. Please try again.");
    expect(screen.getByRole("heading", { name: "Couldn't load brands" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
  });

  it("renders brand list without React key warnings (#359)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    apiGetMock.mockResolvedValueOnce({
      data: {
        brands: [
          { id: "brand-1", name: "Nova Reach", challenges: [] },
          { id: "brand-2", name: "Apex Labs", challenges: [] },
        ],
      },
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Nova Reach")).toBeInTheDocument();
    });

    const keyWarnings = consoleError.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].toLowerCase().includes("key prop")
    );
    expect(keyWarnings).toHaveLength(0);

    consoleError.mockRestore();
  });

  it("does not fire an error toast when brands load successfully", async () => {
    apiGetMock.mockResolvedValueOnce({
      data: {
        brands: [
          {
            id: "brand-1",
            name: "Nova Reach",
            challenges: [],
          },
        ],
      },
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Nova Reach")).toBeInTheDocument();
    });

    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Couldn't load brands" })).not.toBeInTheDocument();
  });
});
