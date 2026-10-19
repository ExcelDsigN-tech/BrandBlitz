import { createError } from "../middleware/error";

/** A small, explicit guard; fraud eligibility is checked separately using the shared utility. */
export function validateCommentBody(body: string): void {
  const normalized = body.normalize("NFKC").toLowerCase();
  if (/\b(fuck|shit|bitch|asshole)\b/i.test(normalized)) {
    throw createError("Please remove profanity from your comment", 422, "COMMENT_PROFANITY");
  }
  if ((normalized.match(/https?:\/\/|www\./g)?.length ?? 0) > 2 || /(.)\1{19}/u.test(normalized)) {
    throw createError("Please remove spam from your comment", 422, "COMMENT_SPAM");
  }
}
