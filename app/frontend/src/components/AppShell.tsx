import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import GenieWidget from "./GenieWidget";

const NAV = [
  { to: "/customers",  label: "Customers" },
  { to: "/dashboard",  label: "Dashboard" },
  { to: "/reports",    label: "Reports" },
];

export default function AppShell({ children }: { children: ReactNode }) {
  // The Apps proxy injects X-Forwarded-Email into requests, but it's not
  // surfaced to the browser. For prod we'd add /api/me; for now show a
  // dev marker so the top bar isn't empty.
  const user = "you@local.dev";
  const workspace = "fevm-serverless-stable-9i2dlu";

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">Customer 360</div>
        <div className="meta">
          <span className="badge">{workspace}</span>
          <span>{user}</span>
        </div>
      </div>
      <nav className="sidebar">
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => isActive ? "active" : ""}>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <main className="content">{children}</main>
      <GenieWidget />
    </div>
  );
}
