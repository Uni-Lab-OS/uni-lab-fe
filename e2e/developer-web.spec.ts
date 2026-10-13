import { expect, test } from "@playwright/test";
import { attachBrowserDiagnostics } from "./helpers/browser-diagnostics";

test.describe("Uni-Lab Developer Web", () => {
  test("navigates through production pages without fixture content", async ({ page }) => {
    const browserErrors = attachBrowserDiagnostics(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "总览", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "工作流" }).click();
    await expect(page.getByRole("heading", { name: "工作流", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "任务" }).click();
    await expect(page.getByRole("heading", { name: "任务", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "设备" }).click();
    await expect(page.getByRole("heading", { name: "设备", exact: true })).toBeVisible();
    expect(browserErrors).toEqual([]);
  });

  test("requires a debug target before entering debug", async ({ page }) => {
    const browserErrors = attachBrowserDiagnostics(page);
    await page.goto("/");
    await page.getByRole("button", { name: /新建调试/ }).click();
    await page.getByText("调试工作流", { exact: true }).click();
    await expect(page.getByText("选择要调试的工作流", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "进入调试" })).toBeDisabled();
    expect(browserErrors).toEqual([]);
  });

  test("returns to the device list after entering from a debug-device target", async ({ page }) => {
    const browserErrors = attachBrowserDiagnostics(page);
    // 深链参数是设备列表里的 deviceUuid（解码后等于 material.uuid）。
    // 设备目录（authoring/device-catalog）的 materialUuid 属于另一套身份，
    // 拿它拼深链永远匹配不到设备，页面会静默停在列表页。
    const devicesResponse = await page.request.get("/__unilab_backend/api/v1/devices");
    test.skip(!devicesResponse.ok(), "需要连接真实 OS 设备列表才能验证入口参数");
    const payload = (await devicesResponse.json()) as {
      data?: readonly { material?: { uuid?: string } }[];
      items?: readonly { material?: { uuid?: string } }[];
    };
    const devices = payload.data ?? payload.items ?? [];
    const target = devices.find((item) => item.material?.uuid);
    const deviceId = target?.material?.uuid;
    test.skip(!deviceId, "设备列表为空");

    await page.goto(`/devices?debugDevice=${encodeURIComponent(deviceId)}`);
    await expect(page.getByRole("button", { name: "返回设备" })).toBeVisible();
    await expect(page.getByRole("button", { name: "调试动作" })).toBeVisible();
    await page.getByRole("button", { name: "返回设备" }).click();
    await expect(page.getByRole("heading", { name: "设备", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "返回设备" })).toHaveCount(0);
    expect(browserErrors).toEqual([]);
  });
});
