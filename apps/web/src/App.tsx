import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import { AssistantPanel } from "./components/AssistantPanel";
import { AddJobPage } from "./pages/AddJobPage";
import { DashboardPage } from "./pages/DashboardPage";
import { TrackerPage } from "./pages/TrackerPage";
import { JobResultPage } from "./pages/JobResultPage";
import { RoleDetailPage } from "./pages/RoleDetailPage";
import { TopJobDetailPage, TopJobsPage } from "./pages/TopJobsPage";

function TopJobDetailRoute() {
  const { id } = useParams();
  return <TopJobDetailPage key={id} />;
}

function App() {
  return (
    <main className="layout">
      <header className="topbar">
        <h1>Job Search Copilot</h1>
        <nav className="row">
          <Link to="/">Dashboard</Link>
          <Link to="/addjob">Add Job</Link>
          <Link to="/top-jobs">Top Jobs</Link>
          <Link to="/tracker">Tracker</Link>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/addjob" element={<AddJobPage />} />
        <Route path="/top-jobs" element={<TopJobsPage />} />
        <Route path="/top-jobs/:id" element={<TopJobDetailRoute />} />
        <Route path="/tracker" element={<TrackerPage />} />
        <Route path="/jobs/:id" element={<JobResultPage />} />
        <Route path="/jobs/:id/detail" element={<RoleDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <AssistantPanel />
    </main>
  );
}

export default App;
