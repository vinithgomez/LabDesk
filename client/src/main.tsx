import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router-dom";
// Self-hosted fonts (DESIGN.md §3): no CDN, so the app works offline. Weights 400, 500, 600 only.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans-condensed/400.css";
import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/600.css";
import { AppShell } from "./components/shell/AppShell";
import { ToastProvider } from "./components/ui";
import { RequireSession } from "./features/auth/RequireSession";
import "./index.css";

// Lazy: /scan's chunk carries html5-qrcode, fetched only when /scan opens.
const ScanPage = lazy(() => import("./features/checkin/ScanPage"));
const CheckinLinkPage = lazy(() => import("./features/checkin/CheckinLinkPage"));
const LoginPage = lazy(() => import("./features/auth/LoginPage"));
const RegisterPage = lazy(() => import("./features/auth/RegisterPage"));
const ResourcesPage = lazy(() => import("./features/resources/ResourcesPage"));
const CalendarPage = lazy(() => import("./features/calendar/CalendarPage"));
const MyBookingsPage = lazy(() => import("./features/bookings/MyBookingsPage"));
const SeriesPage = lazy(() => import("./features/series/SeriesPage"));
const AnalyticsPage = lazy(() => import("./features/analytics/AnalyticsPage"));
const ApprovalsPage = lazy(() => import("./features/approvals/ApprovalsPage"));
const AdminPage = lazy(() => import("./features/admin/AdminPage"));
const AdminResourcesTab = lazy(() => import("./features/admin/ResourcesTab"));
const AdminMaintenanceTab = lazy(() => import("./features/admin/MaintenanceTab"));
const AdminIncidentsTab = lazy(() => import("./features/admin/IncidentsTab"));
const AdminUsersTab = lazy(() => import("./features/admin/UsersTab"));

const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

/** Every screen: the app shell (rail, top bar, tab bar), then the page. */
function Layout() {
  return (
    <AppShell>
      <Suspense fallback={<p className="text-body text-ink-muted">Loading…</p>}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Navigate to="/resources" replace /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      { path: "/resources", element: <RequireSession><ResourcesPage /></RequireSession> },
      { path: "/resources/:id", element: <RequireSession><CalendarPage /></RequireSession> },
      { path: "/bookings", element: <RequireSession><MyBookingsPage /></RequireSession> },
      { path: "/series/:id", element: <RequireSession><SeriesPage /></RequireSession> },
      { path: "/scan", element: <RequireSession><ScanPage /></RequireSession> },
      { path: "/checkin", element: <RequireSession><CheckinLinkPage /></RequireSession> },
      { path: "/analytics", element: <RequireSession><AnalyticsPage /></RequireSession> },
      { path: "/approvals", element: <RequireSession><ApprovalsPage /></RequireSession> },
      {
        path: "/admin",
        element: <RequireSession><AdminPage /></RequireSession>,
        children: [
          { index: true, element: <Navigate to="/admin/resources" replace /> },
          { path: "resources", element: <AdminResourcesTab /> },
          { path: "maintenance", element: <AdminMaintenanceTab /> },
          { path: "incidents", element: <AdminIncidentsTab /> },
          { path: "users", element: <AdminUsersTab /> },
        ],
      },
      { path: "*", element: <Navigate to="/resources" replace /> },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
