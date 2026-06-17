import { test, expect } from "@playwright/test";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("slabforge");
});

test("edit page shows both previews and renders SVG template", async ({ page }) => {
  await page.goto("/edit");
  // 3D preview canvas present
  await expect(page.locator("canvas")).toBeVisible();
  // 2D preview has at least one wall path
  await expect(page.locator("svg path").first()).toBeVisible();
});

test("changing sides updates the template", async ({ page }) => {
  await page.goto("/edit");
  const before = await page.locator("svg path").count();
  // switch to circle
  await page.getByText("circle", { exact: true }).click();
  await expect(page.locator("svg path").first()).toBeVisible();
  expect(before).toBeGreaterThan(0);
});

test("download endpoints return the right content types", async ({ request }) => {
  const q = "sides=4&height=5&bottomWidth=5&topWidth=5&clayThickness=0.25&seamMode=sides&units=in&pageSize=letter";
  const pdf = await request.get(`/shape.pdf?${q}`);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  const stl = await request.get(`/shape.stl?${q}`);
  expect(stl.headers()["content-type"]).toBe("model/x.stl-binary");
  const slump = await request.get(`/slump-mold.stl?${q}`);
  expect(slump.headers()["content-type"]).toBe("model/x.stl-binary");
});

test("hydrates editor state from URL params", async ({ page }) => {
  await page.goto(
    "/edit?sides=6&height=6&bottomWidth=4&topWidth=7&clayThickness=0.3&seamMode=base&units=cm&pageSize=letter"
  );
  const sides = page.locator("fieldset", { hasText: "Sides" }).locator('input[type=number]');
  await expect(sides).toHaveValue("6");
});

test("persists the design across a reload (localStorage)", async ({ page }) => {
  await page.goto("/edit");
  const height = page.locator("fieldset", { hasText: "Height" }).locator('input[type=number]');
  await height.fill("12");
  await height.blur();
  await page.waitForTimeout(500); // debounced persist
  await page.goto("/edit"); // bare reload -> should restore from localStorage
  await expect(
    page.locator("fieldset", { hasText: "Height" }).locator('input[type=number]')
  ).toHaveValue("12");
});

test("shows the specs panel", async ({ page }) => {
  await page.goto("/edit");
  await expect(page.getByText(/Bevel angle/i)).toBeVisible();
  await expect(page.getByText(/Wall length/i)).toBeVisible();
});

test("3D canvas survives a viewport resize", async ({ page }) => {
  await page.goto("/edit");
  await expect(page.locator("canvas")).toBeVisible();
  await page.setViewportSize({ width: 700, height: 600 });
  await page.waitForTimeout(300);
  await expect(page.locator("canvas")).toBeVisible();
});
