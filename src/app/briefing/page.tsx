import Link from 'next/link';

export default function BriefingPage() {
  return (
    <main className="min-h-screen px-6 py-10">
      <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Daily Briefing</h1>
        <p className="mt-3 text-sm text-slate-600">
          This route is reserved for the expanded briefing view. Use the dashboard for MVP
          operations.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          Back to Mission Control
        </Link>
      </section>
    </main>
  );
}
