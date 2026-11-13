import { ArrowLeftRight, Compass, Download, History, Home, Loader2, LogOut, Moon, Puzzle, Search, Settings, Sun, Users, Radio } from "lucide-react";
import { Suspense, useState, useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/AuthContext";
import { useProfiles } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { BrandLogo } from "./BrandLogo";
import { FadeUp } from "./motion/FadeUp";
import { ErrorBoundary } from "./ErrorBoundary";
import { ProfileAvatar } from "./profiles/ProfileAvatar";
import { focusPageStart } from "@/lib/spatialNav";
import { SearchSuggest } from "./catalog/SearchSuggest";

const NAV = [
  { to: "/", label: "Inicio", icon: Home },
  { to: "/discover", label: "Descubrir", icon: Compass },
  { to: "/tv", label: "TV en vivo", icon: Radio },
  { to: "/addons", label: "Addons", icon: Puzzle },
];

function HeaderSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const searchQuery = location.pathname === "/search" ? (params.get("q") ?? "") : "";
  const [q, setQ] = useState(searchQuery);
  // Changing page (a suggestion, a title, the menu) empties the box: the text
  // belongs to the search that was made, not to whatever page comes next.
  useEffect(() => setQ(searchQuery), [location.pathname, searchQuery]);

  return (
    <>
      <SearchSuggest
        value={q}
        onChange={setQ}
        onSubmit={(query) => navigate(`/search?${new URLSearchParams({ q: query })}`)}
        className="hidden w-56 min-[840px]:block"
      />
      <NavLink to="/search" className="min-[840px]:hidden" aria-label={t("Buscar")}>
        <span className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-muted">
          <Search className="size-4" />
        </span>
      </NavLink>
    </>
  );
}

/** Shell for every page that runs as a profile. */
export function AppLayout() {
  const { pathname, search } = useLocation();
  // TV remote: each page starts with something focused.
  useEffect(() => focusPageStart(), [pathname, search]);
  const { logout } = useAuth();
  const { profiles, current, select, clearSelection } = useProfiles();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  return (
    <div className="min-h-svh bg-background">
      <header data-nav-top className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:gap-4">
          <BrandLogo size="sm" className="[&>span]:hidden lg:[&>span]:inline" />
          <nav className="flex flex-1 items-center gap-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                <Icon className="size-4" />
                <span className="hidden sm:inline">{t(label)}</span>
              </NavLink>
            ))}
          </nav>
          <HeaderSearch />
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={t("Cambiar tema")}>
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
          {current && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Perfil: ${current.name}`}>
                  <ProfileAvatar profile={current} size="sm" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-[12rem]">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <ProfileAvatar profile={current} size="sm" className="size-6 text-xs" />
                  <span className="truncate text-sm font-medium">{current.name}</span>
                </div>
                <DropdownMenuSeparator />
                {profiles
                  .filter((p) => p.id !== current.id)
                  .map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onSelect={() => {
                        select(p.id);
                        navigate("/");
                      }}
                    >
                      <ProfileAvatar profile={p} size="sm" className="size-6 text-xs" />
                      {p.name}
                    </DropdownMenuItem>
                  ))}
                <DropdownMenuItem
                  onSelect={() => {
                    clearSelection();
                    navigate("/profiles");
                  }}
                >
                  <ArrowLeftRight />
                  {t("Cambiar perfil")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    clearSelection();
                    navigate("/profiles?manage=1");
                  }}
                >
                  <Users />
                  {t("Administrar perfiles")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/history")}>
                  <History />
                  {t("Historial")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/downloads")}>
                  <Download />
                  {t("Descargas")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate("/settings")}>
                  <Settings />
                  {t("Ajustes")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    logout();
                    navigate("/login");
                  }}
                >
                  <LogOut />
                  {t("Cerrar sesión")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Suspense
          fallback={
            <div className="flex justify-center py-24">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <ErrorBoundary resetKey={pathname}>
            {/* Keyed by path: each page gets a soft entrance. Not the player:
                a transformed ancestor would trap its fullscreen layout. */}
            {pathname.startsWith("/play/") ? (
              <Outlet />
            ) : (
              <FadeUp key={pathname} y={10} duration={0.45}>
                <Outlet />
              </FadeUp>
            )}
          </ErrorBoundary>
        </Suspense>
      </main>
    </div>
  );
}
