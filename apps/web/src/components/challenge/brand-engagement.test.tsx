import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetentionPanel } from "@/app/(brand)/dashboard/retention-panel";
import { InviteCodesPanel } from "@/app/(brand)/dashboard/invite-codes-panel";
import { DuplicateChallengeAction } from "@/app/(brand)/dashboard/duplicate-challenge-action";
import { RedeemInvite } from "@/app/waitlist/redeem-invite";
import WaitlistPage from "@/app/waitlist/page";
import { ChallengeComments } from "./challenge-comments";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  session: { apiToken: "token" } as { apiToken: string } | null,
}));
vi.mock("@/lib/api", () => ({ createApiClient: () => ({ get: mocks.get, post: mocks.post }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: mocks.session }) }));

describe("Brand engagement interfaces", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session = { apiToken: "token" };
  });

  it("explains why retention needs a second challenge", async () => {
    mocks.get.mockResolvedValue({ data: { challengeCount: 1, cohorts: [] } });
    render(<RetentionPanel brandId="brand" apiToken="token" />);
    expect(
      await screen.findByText("Launch at least two challenges to see retention.")
    ).toBeInTheDocument();
  });
  it("shows a retention heatmap with cohort size, zero retention and an unreached week", async () => {
    mocks.get.mockResolvedValue({
      data: {
        challengeCount: 3,
        cohorts: [
          {
            cohort_week: "2026-10-05",
            cohort_size: 10,
            week_offset: 0,
            retained_users: 10,
            retention_pct: 100,
          },
          {
            cohort_week: "2026-10-05",
            cohort_size: 10,
            week_offset: 1,
            retained_users: 0,
            retention_pct: 0,
          },
          {
            cohort_week: "2026-10-12",
            cohort_size: 2,
            week_offset: 0,
            retained_users: 2,
            retention_pct: 100,
          },
        ],
      },
    });
    render(<RetentionPanel brandId="brand" apiToken="token" />);
    expect(await screen.findByText("2026-10-05 / 10")).toBeInTheDocument();
    expect(screen.getByText("0%")).toHaveAttribute("title", "0 of 10 players");
    expect(screen.getByText("—")).toHaveAttribute("title", "Week not reached");
  });
  it("retries a failed retention request", async () => {
    mocks.get
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce({ data: { challengeCount: 2, cohorts: [] } });
    render(<RetentionPanel brandId="brand" apiToken="token" />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry retention" }));
    expect(
      await screen.findByText("Retention will appear once players participate.")
    ).toBeInTheDocument();
  });
  it("generates a challenge-scoped invite with an optional use limit and shows usage", async () => {
    mocks.get.mockResolvedValue({ data: { data: [], nextCursor: null } });
    mocks.post.mockResolvedValue({
      data: {
        inviteCode: {
          id: "invite",
          code: "NEWCODE",
          challenge_id: "challenge",
          max_uses: 3,
          use_count: 0,
          expires_at: null,
        },
      },
    });
    render(
      <InviteCodesPanel
        brandId="brand"
        apiToken="token"
        challenges={[{ id: "challenge", status: "active" }]}
      />
    );
    await screen.findByText("No invite codes yet.");
    fireEvent.change(screen.getByLabelText("Invite scope"), { target: { value: "challenge" } });
    fireEvent.change(screen.getByLabelText("Invite maximum uses"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate invite code" }));
    expect(await screen.findByText("NEWCODE")).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledWith("/brands/brand/invite-codes", {
      challengeId: "challenge",
      maxUses: 3,
    });
    expect(screen.getByText(/0 \/ 3 uses/)).toBeInTheDocument();
  });
  it("redeems an invite and shows durable active access", async () => {
    mocks.get.mockResolvedValue({ data: { status: "waiting" } });
    mocks.post.mockResolvedValue({ data: { status: "active" } });
    render(<RedeemInvite />);
    fireEvent.change(screen.getByLabelText("Invite code"), { target: { value: "  ABC123  " } });
    fireEvent.click(screen.getByRole("button", { name: "Redeem code" }));
    expect(await screen.findByText(/Your early access is active/)).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledWith("/waitlist/redeem-code", { code: "ABC123" });
  });
  it("asks anonymous waitlist users to sign in", () => {
    mocks.session = null;
    render(<RedeemInvite />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?callbackUrl=/waitlist"
    );
    expect(screen.queryByRole("button", { name: "Redeem code" })).not.toBeInTheDocument();
  });
  it("replaces the FIFO signup with active access after reloading the waitlist page", async () => {
    mocks.get.mockResolvedValue({ data: { status: "active" } });
    render(<WaitlistPage />);
    expect(
      await screen.findByRole("heading", { name: "Early access unlocked" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join Waitlist" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explore challenges" })).toHaveAttribute(
      "href",
      "/challenges"
    );
  });
  it("shows invite errors while keeping the code available to retry", async () => {
    mocks.get.mockResolvedValue({ data: { status: "waiting" } });
    mocks.post.mockRejectedValue({ response: { data: { error: "Invite code has expired" } } });
    render(<RedeemInvite />);
    fireEvent.change(screen.getByLabelText("Invite code"), { target: { value: "EXPIRED" } });
    fireEvent.click(screen.getByRole("button", { name: "Redeem code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invite code has expired");
    expect(screen.getByLabelText("Invite code")).toHaveValue("EXPIRED");
  });
  it("loads older comments, posts a new comment and renders HTML as text", async () => {
    mocks.get
      .mockResolvedValueOnce({
        data: {
          data: [
            { id: "1", body: "First", display_name: "Player", created_at: "2026-10-01T00:00:00Z" },
          ],
          nextCursor: "cursor",
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [
            { id: "2", body: "Older", display_name: "Other", created_at: "2026-09-30T00:00:00Z" },
          ],
          nextCursor: null,
        },
      });
    mocks.post.mockResolvedValue({
      data: {
        comment: {
          id: "3",
          body: "<script>hello</script>",
          display_name: "Player",
          created_at: "2026-10-02T00:00:00Z",
        },
      },
    });
    const { container } = render(<ChallengeComments challengeId="challenge" apiToken="token" />);
    await screen.findByText("First");
    fireEvent.click(screen.getByRole("button", { name: "Load older comments" }));
    expect(await screen.findByText("Older")).toBeInTheDocument();
    expect(mocks.get).toHaveBeenLastCalledWith("/challenges/challenge/comments", {
      params: { cursor: "cursor" },
    });
    fireEvent.change(screen.getByLabelText("Your comment"), {
      target: { value: "<script>hello</script>" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    expect(await screen.findByText("<script>hello</script>")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByLabelText("Your comment")).toHaveValue("");
  });
  it("retains a rejected comment so it can be edited", async () => {
    mocks.get.mockResolvedValue({ data: { data: [], nextCursor: null } });
    mocks.post.mockRejectedValue({ response: { data: { error: "Please remove profanity" } } });
    render(<ChallengeComments challengeId="challenge" apiToken="token" />);
    await screen.findByText("No comments yet. Start the discussion.");
    fireEvent.change(screen.getByLabelText("Your comment"), { target: { value: "My draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please remove profanity");
    expect(screen.getByLabelText("Your comment")).toHaveValue("My draft");
  });
  it("duplicates a challenge and refreshes the brand list", async () => {
    mocks.post.mockResolvedValue({ data: { challenge: { id: "clone", status: "draft" } } });
    const refresh = vi.fn();
    render(
      <DuplicateChallengeAction
        challengeId="challenge"
        status="active"
        apiToken="token"
        onUpdated={refresh}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(mocks.post).toHaveBeenCalledWith("/challenges/challenge/duplicate");
  });
  it("requires dates for a draft and shows its new funding instructions", async () => {
    mocks.post.mockResolvedValue({
      data: {
        depositInstructions: { hotWalletAddress: "GTEST", amount: "100", memo: "FRESH_MEMO" },
      },
    });
    render(
      <DuplicateChallengeAction
        challengeId="draft"
        status="draft"
        apiToken="token"
        onUpdated={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Set dates & fund" }));
    fireEvent.change(screen.getByLabelText("Draft start date"), {
      target: { value: "2027-01-01T12:00" },
    });
    fireEvent.change(screen.getByLabelText("Draft end date"), {
      target: { value: "2027-01-01T14:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save dates & get funding instructions" }));
    expect(await screen.findByText("FRESH_MEMO")).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledWith("/challenges/draft/publish-draft", {
      startsAt: new Date("2027-01-01T12:00").toISOString(),
      endsAt: new Date("2027-01-01T14:00").toISOString(),
    });
  });
});
