import type { ReactNode } from "react";
import { DialogHost } from "@/components/DialogHost";
import { Layout } from "@/components/Layout";
import { LogoBadge } from "@/components/Logo";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useOffline } from "@/lib/network";
import { useQuery } from "@/lib/query";
import { Navigate, Routes, useLocation } from "@/lib/router";
import AdminPage from "@/pages/AdminPage";
import BookPage from "@/pages/BookPage";
import BooksPage from "@/pages/BooksPage";
import HomePage from "@/pages/HomePage";
import LoginPage from "@/pages/LoginPage";
import ProfilePage from "@/pages/ProfilePage";
import ReaderPage from "@/pages/ReaderPage";
import RegisterPage from "@/pages/RegisterPage";
import SetupPage from "@/pages/SetupPage";
import ShelvesPage, { ShelfPage } from "@/pages/ShelvesPage";
import WelcomePage from "@/pages/WelcomePage";

function Splash({ error }: { error?: string }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-5 p-6 text-center">
      <LogoBadge size="lg" className={error ? "" : "animate-pulse"} />
      {error && <p className="max-w-sm text-muted">{error}</p>}
    </div>
  );
}

const PUBLIC = ["/setup", "/welcome", "/login", "/register"];

function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.is_admin ? <>{children}</> : <Navigate to="/" />;
}

export default function App() {
  const { ready, user } = useAuth();
  const { pathname } = useLocation();
  const status = useQuery(["setup-status"], api.setup.status, { staleTime: 5 * 60_000 });
  const offline = useOffline();

  if (status.isLoading || !ready) return <Splash />;
  const offlineMode = offline && Boolean(user);
  if (status.error && !offlineMode) return <Splash error="Не удалось связаться с сервером. Проверьте, что контейнер запущен." />;

  const setupDone = offlineMode ? true : status.data?.setup_complete;
  if (!setupDone && pathname !== "/setup") return <Navigate to="/setup" />;

  if (PUBLIC.includes(pathname)) {
    return (
      <>
        <Routes
          routes={[
            { path: "/setup", element: setupDone ? <Navigate to={user ? "/welcome" : "/"} /> : <SetupPage /> },
            { path: "/welcome", element: user?.is_admin ? <WelcomePage /> : <Navigate to="/" /> },
            { path: "/login", element: <LoginPage /> },
            { path: "/register", element: <RegisterPage /> },
          ]}
        />
        <DialogHost />
      </>
    );
  }

  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname)}`} />;

  // Оболочка (меню) не пересоздаётся при переходах — меняется только страница
  return (
    <Layout>
      <Routes
        routes={[
          { path: "/", element: <HomePage /> },
          { path: "/books", element: <BooksPage mode="all" /> },
          { path: "/audio", element: <BooksPage mode="audio" /> },
          { path: "/search", element: <BooksPage mode="search" /> },
          { path: "/libraries/:id", element: <BooksPage mode="library" /> },
          { path: "/books/:id", element: <BookPage /> },
          { path: "/read/:id", element: <ReaderPage /> },
          { path: "/shelves", element: <ShelvesPage /> },
          { path: "/shelves/:id", element: <ShelfPage /> },
          { path: "/profile", element: <ProfilePage /> },
          { path: "/admin", element: <AdminOnly><AdminPage /></AdminOnly> },
          { path: "*", element: <Navigate to="/" /> },
        ]}
      />
      <DialogHost />
    </Layout>
  );
}
