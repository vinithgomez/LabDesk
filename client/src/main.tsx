import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router-dom";
import { AppHeader } from "./features/auth/AppHeader";
import { RequireSession } from "./features/auth/RequireSession";
import "./index.css";

// Lazy: /scan's chunk carries html5-qrcode, fetched only when /scan opens.
const ScanPage = lazy(() => import("./features/checkin/ScanPage"));
const CheckinLinkPage = lazy(() => import("./features/checkin/CheckinLinkPage"));
const LoginPage = lazy(() => import("./features/auth/LoginPage"));

const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

/** Every screen: the header, then the page. */
function Layout() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
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
      { path: "/", element: <Navigate to="/scan" replace /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/scan", element: <RequireSession><ScanPage /></RequireSession> },
      { path: "/checkin", element: <RequireSession><CheckinLinkPage /></RequireSession> },
      { path: "*", element: <Navigate to="/scan" replace /> },
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
