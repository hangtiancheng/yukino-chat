import { setUserId } from "@yukino.js/sentry";
import { useEffect } from "react";
import {
  createBrowserRouter,
  Navigate,
  redirect,
  RouterProvider,
  useRouteError,
} from "react-router-dom";

import { AppShell } from "@/components/app-shell";
import { errorMessage } from "@/service/http";
import useAuthStore, { isAuthenticated } from "./store/auth";
import useWsStore from "./store/ws";
import Chat from "./pages/chat";
import ContactList from "./pages/contact-list";
import Dashboard from "./pages/dashboard";
import Login from "./pages/login";
import Manager from "./pages/manager";
import NotFound from "./pages/not-found";
import OwnInfo from "./pages/own-info";
import Register from "./pages/register";
import SessionList from "./pages/session-list";

const requireAuth = () => (isAuthenticated() ? null : redirect("/login"));

const redirectWhenSignedIn = () => (isAuthenticated() ? redirect("/chat/sessions") : null);

function RootErrorBoundary() {
  const error = useRouteError();
  return (
    <div className="bg-background flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-destructive text-2xl font-semibold">Something went wrong</h1>
        <p className="text-muted-foreground mt-2">{errorMessage(error)}</p>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    loader: requireAuth,
    errorElement: <RootErrorBoundary />,
    children: [
      { index: true, element: <Navigate to="/chat/sessions" replace /> },
      {
        element: <AppShell />,
        children: [
          { path: "chat/sessions", element: <SessionList /> },
          { path: "chat/contacts", element: <ContactList /> },
          { path: "chat/profile", element: <OwnInfo /> },
          { path: "chat/:id", element: <Chat /> },
          { path: "manager", element: <Manager /> },
        ],
      },
      { path: "dashboard", element: <Dashboard /> },
    ],
  },
  { path: "/login", loader: redirectWhenSignedIn, element: <Login /> },
  { path: "/register", loader: redirectWhenSignedIn, element: <Register /> },
  { path: "*", element: <NotFound /> },
]);

export default function App() {
  const userId = useAuthStore((state) => state.userInfo.uuid);

  // Covers first login, a reload with a persisted token, and logout.
  useEffect(() => {
    setUserId(userId || "unknown");
    if (!userId) return;
    const ws = useWsStore.getState();
    ws.connect(userId);
    return () => ws.disconnect();
  }, [userId]);

  return <RouterProvider router={router} />;
}
