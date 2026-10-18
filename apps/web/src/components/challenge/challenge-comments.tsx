"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface Comment {
  id: string;
  body: string;
  display_name: string;
  created_at: string;
}

export function ChallengeComments({
  challengeId,
  apiToken,
}: {
  challengeId: string;
  apiToken?: string;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setComments([]);
    setError("");
    void createApiClient(apiToken)
      .get(`/challenges/${challengeId}/comments`)
      .then((res) => {
        if (!cancelled) {
          setComments(res.data.data);
          setCursor(res.data.nextCursor);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the discussion.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [challengeId, apiToken, attempt]);

  async function more() {
    if (loading || !cursor) return;
    setLoading(true);
    setError("");
    try {
      const res = await createApiClient(apiToken).get(`/challenges/${challengeId}/comments`, {
        params: { cursor },
      });
      setComments((previous) => [
        ...previous,
        ...res.data.data.filter(
          (item: Comment) => !previous.some((existing) => existing.id === item.id)
        ),
      ]);
      setCursor(res.data.nextCursor);
    } catch {
      setError("Couldn't load older comments.");
    } finally {
      setLoading(false);
    }
  }

  async function post(event: FormEvent) {
    event.preventDefault();
    if (!apiToken || posting || !body.trim()) return;
    setPosting(true);
    setError("");
    try {
      const res = await createApiClient(apiToken).post(`/challenges/${challengeId}/comments`, {
        body: body.trim(),
      });
      setComments((previous) => [res.data.comment, ...previous]);
      setBody("");
    } catch (failure) {
      const response = failure as { response?: { data?: { error?: string } } };
      setError(response.response?.data?.error ?? "Couldn't post your comment. Please retry.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <section
      aria-label="Challenge discussion"
      className="space-y-4 rounded-lg border border-[var(--border)] p-5"
    >
      <h2 className="text-lg font-semibold">Discussion</h2>
      {apiToken ? (
        <form onSubmit={post} className="space-y-2">
          <label htmlFor={`comment-${challengeId}`} className="block text-sm">
            Your comment
          </label>
          <textarea
            id={`comment-${challengeId}`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={2000}
            required
            disabled={posting}
            className="min-h-24 w-full rounded-md border border-[var(--border)] bg-[var(--background)] p-3"
          />
          <p className="text-xs text-[var(--muted-foreground)]">
            Keep it respectful. No spam. {body.length}/2000
          </p>
          <Button type="submit" disabled={posting || !body.trim()}>
            {posting ? "Posting…" : "Post comment"}
          </Button>
        </form>
      ) : (
        <p>Sign in to join the discussion.</p>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <Button variant="outline" size="sm" onClick={() => setAttempt(attempt + 1)}>
            Reload discussion
          </Button>
        </p>
      )}
      {loading && <p role="status">Loading comments…</p>}
      {!loading && !error && !comments.length && <p>No comments yet. Start the discussion.</p>}
      <ul className="space-y-4">
        {comments.map((comment) => (
          <li key={comment.id} className="border-t border-[var(--border)] pt-3">
            <p className="text-sm font-medium">
              {comment.display_name}{" "}
              <time
                className="font-normal text-[var(--muted-foreground)]"
                dateTime={comment.created_at}
              >
                {new Date(comment.created_at).toLocaleString()}
              </time>
            </p>
            <p className="whitespace-pre-wrap break-words">{comment.body}</p>
          </li>
        ))}
      </ul>
      {cursor && (
        <Button variant="outline" disabled={loading} onClick={() => void more()}>
          Load older comments
        </Button>
      )}
    </section>
  );
}
