import { Loader2 } from "lucide-react";
import { MotionConfig } from "motion/react";
import { lazy, type ReactNode } from "react";
import { Navigate, Outlet, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ProfileProvider, useProfiles } from "./context/ProfileContext";
import { I18nProvider } from "./i18n";
import { ThemeProvider } from "./context/ThemeContext";
import { setAdultAllowed } from "@/lib/stremio";
import { AddonsProvider } from "./hooks/useAddons";
import { LibraryProvider } from "./hooks/useLibrary";
import AuthCallback from "./pages/AuthCallback";
import Home from "./pages/Home";
import Login from "./pages/Login";
import ProfilePicker from "./pages/ProfilePicker";
import Register from "./pages/Register";

// Secondary pages load on demand to keep the first load small.
const Addons = lazy(() => import("./pages/Addons"));
const Detail = lazy(() => import("./pages/Detail"));
const Discover = lazy(() => import("./pages/Discover"));
const Search = lazy(() => import("./pages/Search"));
const Streams = lazy(() => import("./pages/Streams"));
const Player = lazy(() => import("./pages/Player"));
const History = lazy(() => import("./pages/History"));
const Settings = lazy(() => import("./pages/Settings"));
const Tv = lazy(() => import("./pages/Tv"));
const Legal = lazy(() => import("./pages/Legal"));

function FullPageLoader() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function RequireUser() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Pages that act as a profile: without one chosen, go pick it first. */
function RequireProfile() {
  const { current, loading } = useProfiles();
  if (loading) return <FullPageLoader />;
  if (!current) return <Navigate to="/profiles" replace />;
  // +18 content follows the profile; toggling it reloads the addons.
  setAdultAllowed(Boolean(current.adult_content));
  return (
    <AddonsProvider key={`${current.id}-${current.adult_content}`}>
      <LibraryProvider key={current.id}>
      <AppLayout />
      </LibraryProvider>
    </AddonsProvider>
  );
}

/** The app speaks the current profile's language (or the last one used). */
function ProfileLanguage({ children }: { children: ReactNode }) {
  const { current } = useProfiles();
  return <I18nProvider language={current?.ui_language}>{children}</I18nProvider>;
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    // Animations follow the OS "reduce motion" setting.
    <MotionConfig reducedMotion="user">
    <ThemeProvider>
      <Router>
        <AuthProvider>
          <ProfileProvider>
            <ProfileLanguage>
            <Routes>
              <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
              <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/legal" element={<Legal />} />
              <Route element={<RequireUser />}>
                <Route path="/profiles" element={<ProfilePicker />} />
                <Route element={<RequireProfile />}>
                  <Route path="/" element={<Home />} />
                  <Route path="/discover" element={<Discover />} />
                  <Route path="/tv" element={<Tv />} />
                  <Route path="/search" element={<Search />} />
                  <Route path="/detail/:type/:id" element={<Detail />} />
                  <Route path="/addons" element={<Addons />} />
                  <Route path="/history" element={<History />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/streams/:type/:id" element={<Streams />} />
                  <Route path="/play/:type/:id" element={<Player />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </ProfileLanguage>
          </ProfileProvider>
        </AuthProvider>
      </Router>
    </ThemeProvider>
    </MotionConfig>
  );
}
