'use client';

import Link from 'next/link';
import TiptapEditor from './_components/TiptapEditor';

export default function PlaygroundPage() {
    return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center py-8">
            {/* Header / Nav */}
            <div className="w-full max-w-4xl px-4 mb-6 flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Playground</h1>
                <Link
                    href="/board"
                    className="px-4 py-2 bg-white text-slate-700 font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition"
                >
                    ← Back to Board
                </Link>
            </div>

            {/* Main Content Area - Mimicking Modal Size/Feel */}
            <div className="w-full max-w-4xl px-4">
                {/* Editor Container */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-2 min-h-[80vh]">
                    <TiptapEditor />
                </div>
            </div>
        </div>
    );
}
