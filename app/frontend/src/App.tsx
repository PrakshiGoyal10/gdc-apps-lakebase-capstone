import { Route, Routes, Navigate } from "react-router-dom";
import AppShell from "./components/AppShell";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import Dashboard from "./pages/Dashboard";
import Reports from "./pages/Reports";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/customers" replace />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="*" element={<div className="state">Not found.</div>} />
      </Routes>
    </AppShell>
  );
}
