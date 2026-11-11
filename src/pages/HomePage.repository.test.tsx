import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BusinessSummary,
  Category,
  City,
} from "../features/catalog/schemas.ts";
import { PAGE_SIZE, toPage } from "../lib/pagination.ts";

vi.mock("../features/catalog/repository.ts", () => ({
  listCities: vi.fn(),
  listCategories: vi.fn(),
  listRestaurants: vi.fn(),
  listFeatured: vi.fn(),
  getBusinessHours: vi.fn(),
}));

import * as repo from "../features/catalog/repository.ts";
import { HomePage } from "./HomePage.tsx";

const city: City = {
  id: "c1",
  name: "Itaú de Minas",
  state: "MG",
  slug: "itau-de-minas",
  centerLat: null,
  centerLng: null,
  ibgeCode: null,
  distanceFromHqKm: null,
};
const category: Category = {
  id: "k1",
  slug: "pizza",
  label: "Pizza",
  kind: "restaurante",
  icon: null,
  sortOrder: 1,
};

function business(over: Partial<BusinessSummary> = {}): BusinessSummary {
  return {
    id: "b1",
    name: "Pizzaria do Zé",
    slug: "pizzaria-do-ze",
    businessType: "restaurante",
    categoryId: "k1",
    cityId: "c1",
    description: null,
    coverUrl: null,
    logoUrl: null,
    addressLine: null,
    phone: null,
    whatsapp: null,
    lat: null,
    lng: null,
    distanceEstimateKm: null,
    distanceKm: undefined,
    deliveryOffer: "none",
    ownDeliveryFeeCents: 0,
    acceptsPickup: true,
    estimatedMinMinutes: null,
    estimatedMaxMinutes: null,
    minOrderCents: 0,
    priceTier: null,
    ratingAvg: 0,
    ratingCount: 0,
    popularityScore: 0,
    isFeatured: false,
    isOpen: true,
    ...over,
  };
}

function renderHome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(repo.listCities).mockResolvedValue([city]);
  vi.mocked(repo.listCategories).mockResolvedValue([category]);
  vi.mocked(repo.listRestaurants).mockResolvedValue(toPage([], PAGE_SIZE, 0));
  vi.mocked(repo.listFeatured).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("HomePage com repositório simulado", () => {
  it("mostra skeletons enquanto carrega e os remove depois", async () => {
    vi.mocked(repo.listCities).mockReturnValue(new Promise(() => {}));
    vi.mocked(repo.listCategories).mockReturnValue(new Promise(() => {}));
    renderHome();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Da sua cidade. Do seu jeito.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Restaurantes" }),
    ).toBeInTheDocument();
  });

  it("sem estabelecimentos: oculta seções e mostra estado vazio com ação real", async () => {
    renderHome();
    expect(
      await screen.findByRole("link", { name: /^Pizza$/ }),
    ).toHaveAttribute("href", "/restaurantes?categoria=pizza");
    await waitFor(() =>
      expect(screen.queryAllByTestId("skeleton")).toHaveLength(0),
    );
    for (const title of ["Restaurantes em Itaú de Minas", "Comerciantes em destaque"]) {
      expect(
        screen.queryByRole("heading", { level: 2, name: title }),
      ).not.toBeInTheDocument();
    }
    expect(
      await screen.findByText("Ainda não há estabelecimentos em Itaú de Minas"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Cadastrar meu negócio" }),
    ).toHaveAttribute("href", "/cadastrar-negocio");
    expect(screen.queryByText(/demonstração/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/comunidade|conecta/i)).not.toBeInTheDocument();
  });

  it("lista restaurantes reais da cidade sem selo de demonstração", async () => {
    vi.mocked(repo.listRestaurants).mockResolvedValue(
      toPage([business({ id: "r1", name: "Lanchonete Real", slug: "lanchonete-real" })], PAGE_SIZE, 0),
    );
    renderHome();
    const section = await screen.findByRole("region", {
      name: "Restaurantes em Itaú de Minas",
    });
    expect(
      await within(section).findByRole("link", { name: "Lanchonete Real" }),
    ).toHaveAttribute("href", "/restaurantes/lanchonete-real");
    expect(within(section).getByText("Pizza")).toBeInTheDocument();
    expect(screen.queryByText(/demonstração/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Ainda não há estabelecimentos em Itaú de Minas")).not.toBeInTheDocument();
  });

  it('exibe ErrorState e refaz a consulta ao clicar em "Tentar novamente"', async () => {
    let fail = true;
    vi.mocked(repo.listFeatured).mockImplementation(() =>
      fail
        ? Promise.reject(new Error("falha"))
        : Promise.resolve([
            business({
              name: "Loja Nova",
              slug: "loja-nova",
              businessType: "loja",
            }),
          ]),
    );
    renderHome();
    const section = await screen.findByRole("region", {
      name: "Comerciantes em destaque",
    });
    const retry = await within(section).findByRole("button", {
      name: "Tentar novamente",
    });
    expect(within(section).getByRole("alert")).toBeInTheDocument();
    const calls = vi.mocked(repo.listFeatured).mock.calls.length;

    fail = false;
    fireEvent.click(retry);

    expect(
      await screen.findByRole("link", { name: "Loja Nova" }),
    ).toHaveAttribute("href", "/lojas/loja-nova");
    expect(vi.mocked(repo.listFeatured).mock.calls.length).toBeGreaterThan(
      calls,
    );
    expect(
      screen.queryByRole("button", { name: "Tentar novamente" }),
    ).not.toBeInTheDocument();
  });

  it("exibe ErrorState das categorias e refaz a consulta", async () => {
    vi.mocked(repo.listCategories).mockRejectedValueOnce(new Error("falha"));
    renderHome();
    fireEvent.click(
      await screen.findByRole("button", { name: "Tentar novamente" }),
    );
    expect(
      await screen.findByRole("link", { name: /^Pizza$/ }),
    ).toBeInTheDocument();
    expect(vi.mocked(repo.listCategories)).toHaveBeenCalledTimes(2);
  });
});
