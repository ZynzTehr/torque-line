import type { Metadata } from "next";

export const metadata: Metadata = { title: "Fuel" };

export default function Page() {
  return (
    <>
      <header className="page-header"><h2>Fuel</h2></header>
      <div className="page-body"><p className="text-secondary">Multi-product fuel stops with per-unit cost per mile arrive in the next phase.</p></div>
    </>
  );
}
