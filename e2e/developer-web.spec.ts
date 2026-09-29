import { expect, test } from "@playwright/test";

test.describe("Uni-Lab Developer Web", () => {
  test("navigates through production pages without fixture content", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "总览", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "工作流" }).click();
    await expect(page.getByRole("heading", { name: "工作流", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "任务" }).click();
    await expect(page.getByRole("heading", { name: "任务", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "设备" }).click();
    await expect(page.getByRole("heading", { name: "设备", exact: true })).toBeVisible();
  });

  test("requires a debug target before entering debug", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /新建调试/ }).click();
    await page.getByText("调试工作流", { exact: true }).click();
    await expect(page.getByText("选择要调试的工作流", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "进入调试" })).toBeDisabled();
  });

  test("returns to the device list after entering from a debug-device target", async ({ page }) => {
    const catalogResponse = await page.request.get(
      "/__unilab_backend/api/v1/authoring/device-catalog",
    );
    test.skip(!catalogResponse.ok(), "需要连接真实 OS 设备目录才能验证入口参数");
    const catalog = (await catalogResponse.json()) as {
      items?: readonly { id?: string; materialUuid?: string }[];
      data?: { items?: readonly { id?: string; materialUuid?: string }[] };
    };
    const deviceId = (catalog.items ?? catalog.data?.items)?.[0]?.materialUuid;
    test.skip(!deviceId, "设备目录为空");

    await page.goto(`/devices?debugDevice=${encodeURIComponent(deviceId)}`);
    await expect(page.getByRole("button", { name: "返回设备" })).toBeVisible();
    await page.getByRole("button", { name: "返回设备" }).click();
    await expect(page.getByRole("heading", { name: "设备", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "返回设备" })).toHaveCount(0);
  });
});
