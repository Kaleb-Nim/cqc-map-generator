'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'rmg-password';

export default function Home() {
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setPassword(stored);
      setHasPassword(true);
    }
  }, []);

  useEffect(() => {
    if (!generating) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(timer);
  }, [generating]);

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    localStorage.setItem(STORAGE_KEY, password);
    setHasPassword(true);
  };

  const clearPassword = () => {
    localStorage.removeItem(STORAGE_KEY);
    setPassword('');
    setHasPassword(false);
    setImageUrl(null);
    setError(null);
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setImageUrl(null);
    setElapsed(0);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'x-generate-password': password },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        if (res.status === 401) clearPassword();
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      setImageUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const download = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `run-map-${Date.now()}.png`;
    a.click();
  };

  if (!hasPassword) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-black text-white">
        <form onSubmit={submitPassword} className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-semibold">fuck this CQC</h1>
          <p className="text-sm text-zinc-400">Access password required.</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-md focus:outline-none focus:border-zinc-500"
            autoFocus
          />
          <button
            type="submit"
            className="w-full py-3 bg-white text-black font-semibold rounded-md hover:bg-zinc-200 transition"
          >
            Continue
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center p-6 bg-black text-white">
      <div className="w-full max-w-md space-y-6 mt-12">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">fuck this CQC</h1>
          <button onClick={clearPassword} className="text-xs text-zinc-500 hover:text-zinc-300">
            sign out
          </button>
        </div>

        <button
          onClick={generate}
          disabled={generating}
          className="w-full py-4 bg-white text-black font-semibold rounded-md hover:bg-zinc-200 disabled:bg-zinc-700 disabled:text-zinc-400 transition"
        >
          {generating ? `Generating… ${elapsed}s` : 'Generate'}
        </button>

        {error && (
          <div className="p-3 bg-red-950 border border-red-800 rounded-md text-sm text-red-200">
            {error}
          </div>
        )}

        {imageUrl && (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt="generated run map"
              className="w-full rounded-md border border-zinc-800"
            />
            <button
              onClick={download}
              className="w-full py-3 bg-zinc-800 text-white font-semibold rounded-md hover:bg-zinc-700 transition"
            >
              Download PNG
            </button>
          </div>
        )}

        <p className="text-xs text-zinc-600 text-center pt-4">
          Each generation takes ~30–90s. Random believable workout values are picked server-side.
        </p>
      </div>
    </main>
  );
}
