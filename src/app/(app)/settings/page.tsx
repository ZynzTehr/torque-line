import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <>
      <header className="page-header"><h2>Settings</h2></header>
      <div className="page-body"><p className="text-secondary">Account and fleet settings.</p></div>
    </>
  );
}
