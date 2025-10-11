import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';

import { buildCanonicalTail, CardDetail, getCardByShortId } from '@/lib/cards';
import { buildCanonicalPath } from '@/lib/slug';

import CardAnalyticsClient from './CardAnalyticsClient';

export const runtime = 'nodejs';

type PageParams = {
  params: Promise<{
    short_id: string;
    slug?: string[];
  }>;
};

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { short_id } = await params;
  const card = await getCardByShortId(short_id);
  if (!card || !card.permitted) {
    return {};
  }

  const canonicalPath = buildCanonicalPath({
    shortId: card.shortId,
    idShort: card.idShort,
    slug: card.slug,
  });

  return {
    title: `${card.title} | Taesk`,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title: card.title,
      description: card.description ?? undefined,
      url: canonicalPath,
    },
  };
}

function CardStandalone({ card }: { card: CardDetail }) {
  return (
    <main className="min-h-screen bg-gradient-to-br from-white via-slate-50/40 to-slate-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 md:py-16">
        <CardAnalyticsClient
          cardShortId={card.shortId}
          boardId={card.boardId}
          canonicalPath={buildCanonicalPath({
            shortId: card.shortId,
            idShort: card.idShort,
            slug: card.slug,
          })}
        />
        <header className="space-y-2">
          <p className="text-sm font-medium uppercase tracking-widest text-sky-500">
            Card #{card.idShort ?? card.shortId}
          </p>
          <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">{card.title}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <span>Board ID: {card.boardId}</span>
            <span>Updated {new Date(card.updatedAt).toLocaleString()}</span>
          </div>
        </header>

        {card.description ? (
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-700">Description</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">
              {card.description}
            </p>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Meta
            </h2>
            <dl className="space-y-2 text-sm text-slate-600">
              <div className="flex items-start justify-between gap-4">
                <dt className="font-medium text-slate-700">Priority</dt>
                <dd>{card.priority ?? 'medium'}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="font-medium text-slate-700">Due Date</dt>
                <dd>{card.dueDate ? new Date(card.dueDate).toLocaleDateString() : '—'}</dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="font-medium text-slate-700">Assigned To</dt>
                <dd>{card.assignedTo ?? 'Unassigned'}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Tags
            </h2>
            {card.tags.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {card.tags.map((tag) => (
                  <li
                    key={tag}
                    className="rounded-full bg-sky-100 px-3 py-1 text-sm text-sky-700"
                  >
                    #{tag}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">No tags yet</p>
            )}
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={card.boardId ? `/?board=${card.boardId}` : `/`}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-sky-400 hover:text-sky-600"
          >
            ← Back to board
          </Link>
          <Link
            href={buildCanonicalPath({
              shortId: card.shortId,
              idShort: card.idShort,
              slug: card.slug,
            })}
            className="text-sm font-medium text-sky-600 hover:text-sky-500"
          >
            Copy canonical link
          </Link>
        </div>
      </div>
    </main>
  );
}

export default async function CardPage({ params }: PageParams) {
  const { short_id, slug } = await params;
  const card = await getCardByShortId(short_id);

  if (!card || !card.permitted) {
    notFound();
  }

  const expectedTail = buildCanonicalTail(card);
  const providedTail = (slug ?? []).join('/');

  if (expectedTail && providedTail !== expectedTail) {
    const canonicalPath = buildCanonicalPath({
      shortId: card.shortId,
      idShort: card.idShort,
      slug: card.slug,
    });
    permanentRedirect(canonicalPath);
  }

  if (!expectedTail && providedTail) {
    const canonicalPath = buildCanonicalPath({
      shortId: card.shortId,
      idShort: card.idShort,
      slug: card.slug,
    });
    permanentRedirect(canonicalPath);
  }

  return <CardStandalone card={card} />;
}
