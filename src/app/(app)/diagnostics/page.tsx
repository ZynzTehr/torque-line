import type { Metadata } from "next";

export const metadata: Metadata = { title: "Diagnostics" };

export default function Page() {
  return (
    <>
      <header className="page-header"><h2>Diagnostics</h2></header>
      <div className="page-body"><p className="text-secondary">Describe a symptom, add photos, and work through probable causes. Arriving in the AI phase.</p></div>
    </>
  );
}
