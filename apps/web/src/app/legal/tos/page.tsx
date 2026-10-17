import { api } from "@/lib/api";

interface LegalDocument {
  id: string;
  version: string;
  type: string;
  body_markdown: string;
  effective_at: string;
}

async function getCurrentTos(): Promise<LegalDocument | null> {
  try {
    const res = await api.get("/legal/tos/current");
    return res.data.document;
  } catch {
    return null;
  }
}

export default async function TosPage() {
  const doc = await getCurrentTos();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="mb-2 text-4xl font-bold">Terms of Service</h1>
      {doc && (
        <p className="mb-8 text-sm text-[var(--muted-foreground)]">
          Version {doc.version} — Effective {new Date(doc.effective_at).toLocaleDateString()}
        </p>
      )}
      <div className="prose prose-neutral dark:prose-invert max-w-none">
        {doc ? (
          doc.body_markdown.split("\n").map((line, i) => {
            if (line.startsWith("# "))
              return (
                <h1 key={i} className="mb-4 mt-8 text-3xl font-bold">
                  {line.slice(2)}
                </h1>
              );
            if (line.startsWith("## "))
              return (
                <h2 key={i} className="mb-3 mt-6 text-2xl font-semibold">
                  {line.slice(3)}
                </h2>
              );
            if (line.startsWith("### "))
              return (
                <h3 key={i} className="mb-2 mt-5 text-xl font-medium">
                  {line.slice(4)}
                </h3>
              );
            if (line.startsWith("- "))
              return (
                <li key={i} className="ml-6 list-disc">
                  {line.slice(2)}
                </li>
              );
            if (line.trim() === "") return <br key={i} />;
            return (
              <p key={i} className="mb-3 leading-relaxed">
                {line}
              </p>
            );
          })
        ) : (
          <p>No current Terms of Service available.</p>
        )}
      </div>
    </main>
  );
}
