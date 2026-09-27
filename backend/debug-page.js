const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({
    headless: false,
  });

  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });

  await page.goto("https://demo.inelabteamdev.com/item/2655", {
    waitUntil: "networkidle",
    timeout: 30000,
  });

  await page.waitForTimeout(3000);

  console.log("\n===== BUTTONS =====");

  const buttons = await page.locator("button").evaluateAll((els) =>
    els.map((el) => ({
      text: el.innerText,
      aria: el.getAttribute("aria-label"),
      className: el.className,
    }))
  );

  console.dir(buttons, { depth: null });

  console.log("\n===== TEXT CONTAINING PRICE =====");

  const text = await page.locator("body").innerText();

  console.log(
    text
      .split("\n")
      .filter((line) => /price|today|load|check/i.test(line))
      .join("\n")
  );

  console.log("\n===== HTML AROUND PRICE =====");

  const priceElements = await page.locator("text=/price/i").all();

  console.log("Price-related elements:", priceElements.length);

  await page.screenshot({
    path: "debug-page.png",
    fullPage: true,
  });

  console.log("\nScreenshot saved as backend/debug-page.png");

  await browser.close();
})();
