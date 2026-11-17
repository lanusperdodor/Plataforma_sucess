import { Bell, MapPin, Search, ShoppingBag } from "lucide-react";
import { MenuSearchButton } from "./MenuSearchSheet.tsx";
import { AppDownloadButton } from "./AppDownload.tsx";
import { AccountMenu } from "../account/AccountMenu.tsx";
import { ThemeToggleButton } from "../account/ThemeToggle.tsx";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BRAND } from "../../config/brand.ts";
import type { Breakpoint } from "./useBreakpoint.ts";
import { useCompactHeader } from "./useCompactHeader.ts";
import { formatBadge, useCartSummary, useUnreadCount } from "./useShellData.ts";

export interface TopBarProps {
  layout: Breakpoint;
  /** Substitui o botão de localização padrão. */
  location?: ReactNode;
  /** Substitui a entrada de busca padrão (SmartSearch). */
  search?: ReactNode;
  /** painel simplificado (entregador): sem sacola e com o logo levando às entregas */
  simple?: boolean;
}

const TARGET =
  "pressable inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink";

function Badge({ value }: { value: number }) {
  const text = formatBadge(value);
  if (!text) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-orange px-1 text-center text-[0.6875rem] font-semibold leading-5 text-ink"
    >
      {text}
    </span>
  );
}

function DefaultLocation() {
  return (
    <button
      type="button"
      className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-ink"
    >
      <MapPin aria-hidden="true" className="size-4 text-brand" />
      <span className="truncate">
        {BRAND.initialRegion.city}, {BRAND.initialRegion.state}
      </span>
    </button>
  );
}

function DefaultSearch({ wide }: { wide: boolean }) {
  return (
    <Link
      to="/busca"
      aria-label="Buscar"
      className={`pressable flex min-h-11 items-center gap-2 rounded-full border border-line bg-muted px-4 text-sm text-ink-muted ${wide ? "mx-auto w-full max-w-2xl" : "w-full"}`}
    >
      <Search aria-hidden="true" className="size-4" />
      <span className="truncate">Buscar restaurantes, lojas e serviços</span>
    </Link>
  );
}

// React 18 não tipa inert; o atributo é repassado ao DOM como string vazia.
const inertIf = (on: boolean): Record<string, string> =>
  on ? { inert: "" } : {};

export function TopBar({ layout, location, search, simple = false }: TopBarProps) {
  const compact = useCompactHeader();
  const { count } = useCartSummary();
  const unread = useUnreadCount();
  const desktop = layout !== "mobile";

  const loc = location ?? <DefaultLocation />;
  const srch = search ?? <DefaultSearch wide={desktop} />;

  const bell = (
    <Link
      to="/notificacoes"
      aria-label={
        unread > 0 ? `Notificações, ${unread} não lidas` : "Notificações"
      }
      className={`${TARGET} relative`}
    >
      <Bell aria-hidden="true" className="size-5" />
      <Badge value={unread} />
    </Link>
  );
  const profile = <AccountMenu compact={!desktop} />;
  const theme = <ThemeToggleButton />;
  const bag = simple ? null : (
    <Link
      to="/sacola"
      aria-label={
        count > 0
          ? `Sacola, ${count} ${count === 1 ? "item" : "itens"}`
          : "Sacola"
      }
      className={`${TARGET} relative`}
    >
      <ShoppingBag aria-hidden="true" className="size-5" />
      <Badge value={count} />
    </Link>
  );

  const shell =
    "sticky z-30 border-b border-line bg-surface/90 backdrop-blur-md h-[var(--header-h-expanded)] top-[calc((var(--header-h-expanded)-var(--header-h-compact))*-1)]";
  const hideTop = compact
    ? "opacity-0 -translate-y-2 pointer-events-none"
    : "opacity-100 translate-y-0";
  const fade = `transition-[opacity,transform] duration-200 ease-out ${hideTop}`;

  // painel simplificado (entregador): uma linha só — logo, tema, avisos e conta
  if (layout === "mobile" && simple) {
    return (
      <header className="sticky top-0 z-30 h-[var(--header-h-compact)] border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="flex h-full items-center justify-between gap-2 px-3">
          <MenuSearchButton />
          <Link to="/entregador" aria-label={`${BRAND.name} — entregas`} className="pressable inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center">
            <img src={BRAND.assets.icon} alt="" width={32} height={32} className="size-8 rounded-lg" />
          </Link>
          <div className="ml-auto flex shrink-0 items-center">{theme}{bell}{profile}</div>
        </div>
      </header>
    );
  }

  if (layout === "mobile") {
    return (
      <header data-compact={compact} className={shell}>
        <div className="flex h-full flex-col justify-between px-3 py-2">
          <div
            className={`flex items-center justify-between gap-1 ${fade}`}
            {...inertIf(compact)}
          >
            <MenuSearchButton />
            <Link
              to={simple ? '/entregador' : '/'}
              aria-label={`${BRAND.name} — início`}
              className="pressable inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center"
            >
              <img
                src={BRAND.assets.icon}
                alt=""
                width={32}
                height={32}
                className="size-8 rounded-lg"
              />
            </Link>
            <div className="min-w-0 flex-1">{loc}</div>
            <div className="flex shrink-0 items-center">
              {theme}
              {bell}
              {profile}
              {bag}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">{srch}</div>
            {compact && bag}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header data-compact={compact} className={shell}>
      <div className="mx-auto flex h-full max-w-6xl items-center gap-4 px-6">
        <Link
          to={simple ? "/entregador" : "/"}
          aria-label={`${BRAND.name} — início`}
          className="pressable inline-flex min-h-11 shrink-0 items-center"
        >
          <img
            src={BRAND.assets.logoHorizontal}
            alt=""
            width={138}
            height={40}
            className="h-10 w-auto brand-logo"
          />
        </Link>
        <div className={fade} {...inertIf(compact)}>
          {loc}
        </div>
        <div className="min-w-0 flex-1">{srch}</div>
        <div className="flex items-center gap-1">
          <AppDownloadButton />
          {theme}
          {bell}
          {profile}
          {bag}
        </div>
      </div>
    </header>
  );
}
