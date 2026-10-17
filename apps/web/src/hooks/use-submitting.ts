"use client";

import { useState, useCallback } from "react";

export function useSubmitting() {
  const [submitting, setSubmitting] = useState(false);

  const wrap = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setSubmitting(true);
    try {
      return await fn();
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { submitting, wrap, setSubmitting };
}
