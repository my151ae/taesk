import { notFound } from "next/navigation";

import { buildBoardUrl } from "@/lib/board-url";
import { normalizeCardSlugOrRedirect } from "@/lib/server/cards";

export const revalidate = 0;

export default async function CardFullPage({
  params,
}: {
  params: Promise<{
    short_id: string;
    slug?: string[];
  }>;
}) {
  const { short_id, slug = [] } = await params;
  const { card } = await normalizeCardSlugOrRedirect(short_id, slug);

  if (!card) {
    notFound();
  }

  const boardUrl = card.board ? buildBoardUrl(card.board) : "";
  const createdAt = new Date(card.created_at);
  const updatedAt = new Date(card.updated_at);
  const tags = Array.isArray(card.tags) ? card.tags : [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-sky-50">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-2">
          <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Card Detail
          </span>
          <h1 className="text-3xl font-bold text-slate-900">{card.title}</h1>
          {card.board && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>Board:</span>
              {boardUrl ? (
                <a href={boardUrl} className="font-medium text-sky-600 hover:underline">
                  {card.board.name}
                </a>
              ) : (
                <span className="font-medium">{card.board.name}</span>
              )}
            </div>
          )}
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <dl className="grid gap-6 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Card ID</dt>
              <dd className="mt-1 font-mono text-sm text-slate-800">{card.short_id}</dd>
            </div>
            {card.id_short ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Board Sequence</dt>
                <dd className="mt-1 text-sm text-slate-800">#{card.id_short}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Priority</dt>
              <dd className="mt-1 capitalize text-sm text-slate-800">{card.priority}</dd>
            </div>
            {card.due_date ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Due Date</dt>
                <dd className="mt-1 text-sm text-slate-800">
                  {new Date(card.due_date).toLocaleString("ja-JP", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Updated</dt>
              <dd className="mt-1 text-sm text-slate-800">
                {updatedAt.toLocaleString("ja-JP", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Created</dt>
              <dd className="mt-1 text-sm text-slate-800">
                {createdAt.toLocaleString("ja-JP", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </dd>
            </div>
          </dl>

          <div className="mt-8 space-y-6">
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Description</h2>
              <p className="mt-2 whitespace-pre-wrap text-base leading-7 text-slate-800">
                {card.description || "No description"}
              </p>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Tags</h2>
              {tags.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <li
                      key={tag}
                      className="rounded-full bg-sky-100 px-3 py-1 text-sm font-medium text-sky-700"
                    >
                      #{tag}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-500">No tags</p>
              )}
            </section>
          </div>
        </section>

        <footer className="flex flex-wrap items-center gap-3">
          {boardUrl ? (
            <a
              href={boardUrl}
              className="rounded-lg border border-sky-200 bg-sky-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-600"
              data-testid="card-fullpage-open-board-button"
            >
              ボードを開く
            </a>
          ) : null}
          <span className="text-xs text-slate-500">Shareable card URL</span>
        </footer>
      </div>
    </div>
  );
}
