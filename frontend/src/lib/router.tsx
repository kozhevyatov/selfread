/**
 * Маленький роутер на History API: Link, navigate, useLocation, useParams, Routes.
 * Переход между страницами не перезагружает приложение:
 * аудиокнига продолжает играть, а прокрутка восстанавливается при «назад».
 */
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

type Loc = { pathname: string; search: string; state: unknown };

const NAV_EVENT = "sr:navigate";
let snapshot: Loc = read();

function read(): Loc {
  return { pathname: window.location.pathname, search: window.location.search, state: window.history.state?.usr ?? null };
}

function emit() {
  snapshot = read();
  window.dispatchEvent(new Event(NAV_EVENT));
}

/* Страница прокручивается не документом, а контейнером #app-scroll (см. Layout):
   так нижняя панель на iPhone не прыгает между короткими и длинными экранами.
   Поэтому позицию прокрутки при «назад» восстанавливаем сами. */
export function scroller(): HTMLElement | null {
  return document.getElementById("app-scroll");
}
const positions = new Map<string, number>();
const keyOf = () => (window.history.state?.key as string | undefined) ?? "root";
function saveScroll() {
  const el = scroller();
  if (el) positions.set(keyOf(), el.scrollTop);
}
function restoreScroll() {
  const target = positions.get(keyOf()) ?? 0;
  let tries = 0;
  const step = () => {
    const el = scroller();
    if (!el) return;
    el.scrollTop = target;
    // данные страницы могут ещё грузиться — ждём, пока высоты хватит (до ~1.5 с)
    if (Math.abs(el.scrollTop - target) > 2 && tries++ < 90) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
let lastKey = keyOf();
window.addEventListener("popstate", () => {
  const el = scroller();
  if (el) positions.set(lastKey, el.scrollTop);
  lastKey = keyOf();
  emit();
  restoreScroll();
});

function subscribe(cb: () => void) {
  window.addEventListener(NAV_EVENT, cb);
  return () => window.removeEventListener(NAV_EVENT, cb);
}

export function navigate(to: string | number, opts: { replace?: boolean; state?: unknown } = {}) {
  if (typeof to === "number") {
    window.history.go(to);
    return;
  }
  const url = new URL(to, window.location.href);
  if (url.pathname + url.search === window.location.pathname + window.location.search && !opts.state) {
    scroller()?.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  saveScroll();
  const key = opts.replace ? keyOf() : Math.random().toString(36).slice(2, 10);
  const data = { usr: opts.state ?? null, key };
  if (opts.replace) window.history.replaceState(data, "", url.pathname + url.search + url.hash);
  else window.history.pushState(data, "", url.pathname + url.search + url.hash);
  lastKey = key;
  emit();
  if (!opts.replace) scroller()?.scrollTo(0, 0);
}

export function useLocation(): Loc {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function useSearchParams(): URLSearchParams {
  const { search } = useLocation();
  return new URLSearchParams(search);
}

export function setSearchParam(key: string, value: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (value === null || value === "") params.delete(key);
  else params.set(key, value);
  const q = params.toString();
  navigate(window.location.pathname + (q ? `?${q}` : ""), { replace: true });
}

export function useNavigate() {
  return navigate;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; replace?: boolean; state?: unknown };

export function Link({ to, replace, state, onClick, children, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (rest.target && rest.target !== "_self") return;
    e.preventDefault();
    navigate(to, { replace, state });
  };
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  );
}

// ---------- сопоставление путей ----------

export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  if (pattern === "*") return {};
  const p = pattern.split("/").filter(Boolean);
  const s = pathname.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

const ParamsContext = createContext<Record<string, string>>({});

export function useParams<T extends Record<string, string>>() {
  return useContext(ParamsContext) as T;
}

export type RouteDef = { path: string; element: ReactNode };

export function Routes({ routes }: { routes: RouteDef[] }) {
  const { pathname } = useLocation();
  for (const r of routes) {
    const params = matchPath(r.path, pathname);
    if (params) {
      // key — чтобы страница с другим id монтировалась заново и не показывала старые данные
      return (
        <ParamsContext.Provider value={params} key={r.path === "*" ? "*" : pathname}>
          {r.element}
        </ParamsContext.Provider>
      );
    }
  }
  return null;
}

export function Navigate({ to, replace = true }: { to: string; replace?: boolean }) {
  queueMicrotask(() => navigate(to, { replace }));
  return null;
}

export function isActive(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to + "/");
}
