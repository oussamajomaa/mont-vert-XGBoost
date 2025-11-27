import { test, expect, request } from '@playwright/test';

const FRONT = 'http://localhost:5173';
const API   = 'http://localhost:4000';

// Helpers API pour seed
async function seedAdmin(api: any, email: string, password: string) {
  await api.post(`${API}/auth/login`, { data: { email, password } }); // cookie JWT stocké dans le context
}

async function ensureProduct(api: any, name: string, unit: string) {
  // cherche
  const res = await api.get(`${API}/products`, { params: { page:1, pageSize:50, q:name } });
  const js = await res.json();
  if (js.data?.length) return js.data[0];
  // crée
  await api.post(`${API}/products`, { data: { name, unit, cost:1.2, active:true, alert_threshold:0 }});
  const res2 = await api.get(`${API}/products`, { params: { page:1, pageSize:50, q:name } });
  const js2 = await res2.json();
  return js2.data[0];
}

async function createLot(api: any, product_id: number, quantity: number) {
  const expiry_date = '2099-01-01';
  const { status, json } = await api.post(`${API}/lots`, { data: { product_id, batch_number:`E2E-${Date.now()}`, expiry_date, quantity }});
  const body = await json();
  return body.id;
}

async function ensureRecipe(api: any, name: string, product_id: number) {
  const list = await (await api.get(`${API}/recipes`, { params: { page:1, pageSize:1000, q:name } })).json();
  if (list.data?.length) return list.data[0];
  const pay = { name, base_portions: 10, waste_rate: 5, items: [{ product_id, qty_per_portion: 0.1 }] };
  const created = await (await api.post(`${API}/recipes`, { data: pay })).json();
  return { id: created.id, name };
}

test('MealPlan flow: create → add dish → confirm → execute → visible in Movements', async ({ page, context }) => {
  // --- seed via API ---
  const api = await request.newContext({ baseURL: API });
  await seedAdmin(api, 'admin@mv.fr', 'Admin@123'); // adapte aux creds

  const product = await ensureProduct(api, 'E2E Flour', 'kg');
  await createLot(api, product.id, 10); // 10 kg dispo
  const recipe = await ensureRecipe(api, 'E2E Dish', product.id);

  // --- UI ---
  await page.goto(`${FRONT}/login`);
  await page.getByLabel('Email').fill('osm70@gmx.com');
  await page.getByLabel('Password').fill('osm');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Aller à Meal Plans
  await page.getByText('Meal Plans').first().click(); // via sidebar
  await page.getByRole('button', { name: 'New plan' }).click();
  // remplir dates
  await page.locator('input[type="date"]').first().fill('2030-01-01');
  await page.locator('input[type="date"]').nth(1).fill('2030-01-07');
  await page.getByRole('button', { name: 'Create' }).click();

  // ouvrir premier plan (View)
  await page.getByRole('link', { name: 'View' }).first().click();

  // Add dish
  await page.getByRole('button', { name: 'Add dish' }).click();
  await page.locator('select').selectOption({ label: 'E2E Dish' });
  await page.getByLabel('Planned portions').fill('50'); // besoin 0.1*50*1.05 = 5.25 kg
  await page.getByRole('button', { name: 'Add' }).click();

  // Confirm (réservations FEFO)
  await page.getByRole('button', { name: /Confirm \(reserve FEFO\)/ }).click();

  // Execute (ex. 40 portions)
  await page.getByRole('button', { name: 'Execute' }).click();
  await page.getByLabel('Produced portions').fill('40'); // 4.2 kg sortis
  await page.getByRole('button', { name: 'Execute' }).last().click();

  // Movements : vérifier un OUT récent pour E2E Flour
  await page.getByText('Movements').first().click();
  await page.getByPlaceholder('Search product / batch / user / recipe…').fill('E2E Flour');
  await expect(page.getByText('OUT')).toBeVisible();
});

test('Force add: add infeasible dish, then confirm fails', async ({ page }) => {
  // login
  await page.goto(`${FRONT}/login`);
  await page.getByLabel('Email').fill('osm70@gmx.com');
  await page.getByLabel('Password').fill('osm');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // créer plan
  await page.getByText('Meal Plans').first().click();
  await page.getByRole('button', { name: 'New plan' }).click();
  await page.locator('input[type="date"]').first().fill('2030-02-01');
  await page.locator('input[type="date"]').nth(1).fill('2030-02-07');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('link', { name: 'View' }).first().click();

  // Add dish non faisable
  await page.getByRole('button', { name: 'Add dish' }).click();
  await page.locator('select').selectOption({ label: 'E2E Dish' });
  await page.getByLabel('Planned portions').fill('9999'); // besoin >> stock
  // Bouton Add désactivé, utiliser Force add
  await page.getByRole('button', { name: 'Force add' }).click();

  // Confirm -> doit échouer -> alerte
  page.on('dialog', async d => { await d.accept(); }); // si alert natif
  await page.getByRole('button', { name: /Confirm/ }).click();
  // On s'attend à voir un message d'erreur (alert)
});
