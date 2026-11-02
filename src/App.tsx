/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';

export default function App() {
  useEffect(() => {
    // Redirect to study batches if directly loaded
    window.location.replace('/study/batches');
  }, []);

  return (
    <div className="min-h-screen bg-[#0b1020] text-white flex flex-col items-center justify-center p-6 text-center">
      <img
        src="https://i.ibb.co/Q3g9fGSt/1791541921524.png"
        alt="GB STUDY Logo"
        className="h-20 w-20 rounded-2xl mb-4 shadow-lg"
      />
      <h1 className="text-3xl font-extrabold tracking-tight mb-2">GB STUDY</h1>
      <p className="text-slate-400 mb-6">Loading all batches and study resources...</p>
      <a
        href="/study/batches"
        className="px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold transition"
      >
        Go to Batches
      </a>
    </div>
  );
}
