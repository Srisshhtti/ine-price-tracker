const { chromium } = require("playwright");

async function scrapeProduct({
  productId,
  productUrl,
  optionId,
  optionLabel,
  headless = true,
}) {
  const browser = await chromium.launch({
    headless,
  });

  const context = await browser.newContext({
    viewport: {
      width: 1280,
      height: 800,
    },
  });

  const page = await context.newPage();
  const start = Date.now();

  let challengeFailed = false;

  try {
    // ---------------------------------------------------------
    // Monitor the site's handshake/challenge response
    // ---------------------------------------------------------
    page.on("response", (response) => {
      if (
        response.url().includes("/api/v2/handshake") &&
        response.status() === 401
      ) {
        challengeFailed = true;
      }
    });

    // ---------------------------------------------------------
    // Open product
    // ---------------------------------------------------------
    await page.goto(productUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForTimeout(2000);

    // ---------------------------------------------------------
    // Handle cookie consent
    // ---------------------------------------------------------
    const allowCookies = page.getByRole("button", {
      name: "Allow cookies",
      exact: true,
    });

    if (await allowCookies.count()) {
      try {
        await allowCookies.first().click({
          timeout: 5000,
        });

        await page.waitForTimeout(1000);
      } catch {
        // Continue; overlay may disappear automatically.
      }
    }

    // ---------------------------------------------------------
    // If consent overlay is still present, try again
    // ---------------------------------------------------------
    const consentScrim = page.locator(".consent-scrim");

    if (await consentScrim.count()) {
      const visibleScrim = consentScrim.filter({
        visible: true,
      });

      if (await visibleScrim.count()) {
        const allowButton = page.getByRole("button", {
          name: "Allow cookies",
          exact: true,
        });

        if (await allowButton.count()) {
          try {
            await allowButton.first().click({
              force: true,
              timeout: 3000,
            });

            await page.waitForTimeout(1000);
          } catch {
            // Continue and let the scraper report the real failure.
          }
        }
      }
    }

    // ---------------------------------------------------------
    // Select requested option
    // ---------------------------------------------------------
    if (optionLabel) {
      const option = page.locator("button.opt-chip", {
        hasText: optionLabel,
      });

      if (!(await option.count())) {
        throw new Error("OPTION_NOT_FOUND");
      }

      try {
        await option.first().click({
          timeout: 5000,
        });
      } catch {
        await option.first().click({
          force: true,
        });
      }

      await page.waitForTimeout(1000);
    }

    // ---------------------------------------------------------
    // Find price button
    // ---------------------------------------------------------
    const priceButton = page.getByRole("button", {
      name: "Check today’s price",
      exact: true,
    });

    if (!(await priceButton.count())) {
      throw new Error("PRICE_BUTTON_NOT_FOUND");
    }

    const button = priceButton.first();

    // ---------------------------------------------------------
    // Check if challenge already failed
    // ---------------------------------------------------------
    if (challengeFailed) {
      throw new Error("CHALLENGE_FAILED");
    }

    // ---------------------------------------------------------
    // Wait briefly for the button to become enabled
    // ---------------------------------------------------------
    try {
      await button.waitFor({
        state: "visible",
        timeout: 5000,
      });
    } catch {
      throw new Error("PRICE_BUTTON_NOT_VISIBLE");
    }

    // Give page JS a short time to enable the button.
    await page.waitForTimeout(1500);

    // ---------------------------------------------------------
    // Do NOT spend 30 seconds interacting with a disabled button
    // ---------------------------------------------------------
    const isDisabled = await button.isDisabled();

    if (isDisabled) {
      throw new Error("PRICE_BUTTON_DISABLED");
    }

    // ---------------------------------------------------------
    // Normal browser interaction
    // ---------------------------------------------------------
    await button.scrollIntoViewIfNeeded();

    await button.hover({
      timeout: 5000,
    });

    await page.waitForTimeout(1000);

    await button.click({
      timeout: 5000,
    });

    // ---------------------------------------------------------
    // Wait for live price response
    // ---------------------------------------------------------
    await page.waitForTimeout(10000);

    // ---------------------------------------------------------
    // Read page
    // ---------------------------------------------------------
    const bodyText = (
      await page.locator("body").innerText()
    ).toLowerCase();

    if (
      challengeFailed ||
      bodyText.includes("challenge_failed") ||
      bodyText.includes("couldn’t load the price") ||
      bodyText.includes("couldn't load the price")
    ) {
      throw new Error("CHALLENGE_FAILED");
    }

    // ---------------------------------------------------------
    // Extract price
    // ---------------------------------------------------------
    const priceText = await findPriceText(page);
    const price = parsePrice(priceText);

    if (price === null) {
      throw new Error("PRICE_NOT_AVAILABLE");
    }

    // ---------------------------------------------------------
    // Extract stock
    // ---------------------------------------------------------
    const stock = await findStock(page);

    if (stock === null) {
      throw new Error("STOCK_NOT_AVAILABLE");
    }

    // ---------------------------------------------------------
    // Successful observation
    // ---------------------------------------------------------
    return {
      success: true,
      productId,
      optionId,
      optionLabel,
      price,
      stock,
      error: null,
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      success: false,
      productId,
      optionId,
      optionLabel,
      price: null,
      stock: null,
      error: error.message || "UNKNOWN_ERROR",
      durationMs: Date.now() - start,
    };
  } finally {
    await browser.close();
  }
}


// ============================================================
// PRICE EXTRACTION
// ============================================================

async function findPriceText(page) {
  const selectors = [
    '[class*="price"]',
    '[class*="Price"]',
    '[data-testid*="price"]',
    '[data-test*="price"]',
  ];

  for (const selector of selectors) {
    try {
      const elements = page.locator(selector);
      const count = await elements.count();

      for (let i = 0; i < count; i++) {
        const text = (
          await elements.nth(i).innerText()
        ).trim();

        if (
          text &&
          /(?:₹|\$|€|£)\s?[\d,.]+/.test(text)
        ) {
          return text;
        }
      }
    } catch {
      // Continue.
    }
  }

  return null;
}


// ============================================================
// PRICE PARSER
// ============================================================

function parsePrice(text) {
  if (!text) {
    return null;
  }

  const match = text.match(
    /(?:₹|\$|€|£)\s?([\d,]+(?:\.\d{1,2})?)/
  );

  if (!match) {
    return null;
  }

  const value = Number(
    match[1].replace(/,/g, "")
  );

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}


// ============================================================
// STOCK EXTRACTION
// ============================================================

async function findStock(page) {
  const bodyText = await page.locator("body").innerText();

  const patterns = [
    /stock\s*[:\-]?\s*(\d+)/i,
    /(\d+)\s+in\s+stock/i,
    /available\s*[:\-]?\s*(\d+)/i,
    /quantity\s*[:\-]?\s*(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = bodyText.match(pattern);

    if (match) {
      const stock = Number(match[1]);

      if (
        Number.isInteger(stock) &&
        stock >= 0
      ) {
        return stock;
      }
    }
  }

  if (/out\s+of\s+stock/i.test(bodyText)) {
    return 0;
  }

  if (/unavailable/i.test(bodyText)) {
    return 0;
  }

  return null;
}


module.exports = {
  scrapeProduct,
};
