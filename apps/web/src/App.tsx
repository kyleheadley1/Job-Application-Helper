import { useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useParams } from "react-router-dom";
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

const THEMES = [
  { id: "light", label: "Paper", mode: "light" },
  { id: "atmos", label: "Dark", mode: "dark" },
  { id: "classic", label: "Classic dark", mode: "dark" },
] as const;
type Theme = (typeof THEMES)[number]["id"];

function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(() => {
    const current = document.documentElement.dataset.theme;
    return THEMES.some((t) => t.id === current) ? (current as Theme) : "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = THEMES.find((t) => t.id === theme)?.mode ?? "light";
    localStorage.setItem("theme", theme);
  }, [theme]);
  return (
    <select
      className="theme-picker"
      value={theme}
      onChange={(e) => setTheme(e.target.value as Theme)}
      aria-label="Theme"
    >
      {THEMES.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  );
}

function App() {
  return (
    <main className="layout">
      <header className="topbar">
        <h1>Job Search Copilot</h1>
        <nav className="row">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/addjob">Add Job</NavLink>
          <NavLink to="/top-jobs">Top Jobs</NavLink>
          <NavLink to="/tracker">Tracker</NavLink>
          <ThemePicker />
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
