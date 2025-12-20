import { notFound } from "next/navigation";
import { redirect } from "next/navigation";

import { buildBoardUrl } from "@/lib/board-url";
import { resolveAppOrigin } from "@/lib/calendarSyncService";
import { normalizeCardSlugOrRedirect } from "@/lib/server/cards";
import { getBlockPlainText, normalizeBlockNoteDocument } from "@/lib/blocknote";

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
  const contentBlocks = normalizeBlockNoteDocument(card.content ?? []);
  const bodyBlocks = contentBlocks.slice(1);

  // Deep linkはボード上のモーダルを開きたいケースが多いため、ボードURLが判明していれば
  // `/board...?card=SHORTID` にリダイレクトする。共有ページとしての表示はフォールバック。
  if (boardUrl && card.short_id) {
    const redirectUrl = new URL(boardUrl, resolveAppOrigin());
    redirectUrl.searchParams.set("card", card.short_id);
    redirect(redirectUrl.toString());
  } else if (boardUrl) {
    redirect(boardUrl);
  }

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
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Notes</h2>
              {bodyBlocks.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No content</p>
              ) : (
                <div className="mt-2 space-y-2 text-base leading-6 text-slate-800">
                  {bodyBlocks.map((block, index) => {
                    const text = getBlockPlainText(block);
                    if (!text) return null;
                    return <p key={`block-${index}`}>{text}</p>;
                  })}
                </div>
              )}
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
