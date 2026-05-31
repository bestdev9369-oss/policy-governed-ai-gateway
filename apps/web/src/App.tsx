import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/Sidebar.js';
import { RequestList } from './components/RequestList.js';
import { RequestDetail } from './components/RequestDetail.js';
import { AuditPage } from './pages/AuditPage.js';
import { PoliciesPage } from './pages/PoliciesPage.js';
import { DemoPanel } from './components/DemoPanel.js';

function Header({ title }: { title: string }) {
  return (
    <div style={{
      padding: '14px 24px',
      borderBottom: '1px solid #2d3148',
      background: '#1a1d27',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <span style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9' }}>{title}</span>
      <span style={{ fontSize: 11, color: '#334155' }}>
        policy-governed-ai-gateway · v0.1.0
      </span>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Sidebar />
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Routes>
            <Route
              path="/"
              element={
                <>
                  <Header title="Gateway Requests" />
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    <RequestList />
                  </div>
                </>
              }
            />
            <Route
              path="/requests/:id"
              element={
                <>
                  <Header title="Request Detail" />
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    <RequestDetail />
                  </div>
                </>
              }
            />
            <Route
              path="/audit"
              element={
                <>
                  <Header title="Audit Logs" />
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    <AuditPage />
                  </div>
                </>
              }
            />
            <Route
              path="/policies"
              element={
                <>
                  <Header title="Policy Rules" />
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    <PoliciesPage />
                  </div>
                </>
              }
            />
            <Route
              path="/demo"
              element={
                <>
                  <Header title="Demo Scenarios" />
                  <div style={{ flex: 1, overflow: 'auto' }}>
                    <DemoPanel />
                  </div>
                </>
              }
            />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
