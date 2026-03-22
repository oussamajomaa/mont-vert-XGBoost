// Un vrai test E2E Playwright utile dès maintenant
import { test, expect } from '@playwright/test'

test('T-SEC-06 - un utilisateur Kitchen ne peut pas accéder à la page Admin', async ({ page }) => {
  await page.goto('/login')

  await page.getByLabel(/email/i).fill('kitchen1@test.local')
  await page.getByLabel(/mot de passe/i).fill('Password123!')
  await page.getByRole('button', { name: /connexion|login/i }).click()

  await page.goto('/users')

  await expect(page).toHaveURL(/(dashboard|403|login)/)
  await expect(page.getByText(/forbidden|403|unauthorized|accès refusé/i)).toBeVisible()
})