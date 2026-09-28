import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from "react-router-dom";
import { AppHeader } from "./features/auth/AppHeader";
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
const AnalyticsPage = lazy(() => import("./features/analytics/AnalyticsPage"));

const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

/** Paths laid out for a phone: signing in, and scanning at the resource. */
const PHONE_WIDTH = ["/login", "/register", "/scan", "/checkin"];

/** Every screen: the header, then the page. Desk screens use the full width. */
function Layout() {
  const { pathname } = useLocation();
  const wide = !PHONE_WIDTH.includes(pathname);
  return (
    <main
      className={`mx-auto flex min-h-dvh w-full flex-col px-4 pt-3 pb-[max(2rem,env(safe-area-inset-bottom))] ${wide ? "max-w-7xl" : "max-w-md"}`}
    >
      <AppHeader />
      <Suspense fallback={<p className="text-xl text-slate-300">Loading…</p>}>
        <Outlet />
      </Suspense>
    </main>
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
      { path: "/scan", element: <RequireSession><ScanPage /></RequireSession> },
      { path: "/checkin", element: <RequireSession><CheckinLinkPage /></RequireSession> },
      { path: "/analytics", element: <RequireSession><AnalyticsPage /></RequireSession> },
      { path: "*", element: <Navigate to="/resources" replace /> },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
