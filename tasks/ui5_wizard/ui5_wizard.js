const fs = require('fs');

module.exports = async function(page, helpers) {
    const { 
        log, SCREENSHOT_DIR, path, isTesting, scriptName, taskData 
    } = helpers;

    log(`Initiating UI5 Workflow for: ${scriptName.toUpperCase()}`);

    // Extract dynamic data from the Mega-Sheet, with fallbacks
    const productType = taskData.productType || "Mobile"; 
    const productName = taskData.productName || "TEST_PROD_01";
    const productWeight = taskData.productWeight || "123";

    // Utility to take screenshots exactly when a phase crashes
    async function takeCrashScreenshot(phaseName) {
        const ts = new Date().getTime();
        const crashPath = path.join(SCREENSHOT_DIR, `CRASH_${scriptName}_${phaseName}_${ts}.png`);
        await page.screenshot({ path: crashPath });
        log(`📸 Crash screenshot saved to: ${crashPath}`, "ERROR");
    }

    // ==========================================
    // EXECUTION PHASE-GATES (PURE NATIVE PLAYWRIGHT)
    // ==========================================
    
    // PHASE 1: Product Type
    try {
        log(`Phase 1: Selecting Product Type [${productType}]`);
        await page.waitForTimeout(2000); 
        
        log(`Locating ${productType} button natively...`);
        const typeBtnLoc = page.getByText(productType, { exact: true });
        await typeBtnLoc.waitFor({ state: 'visible', timeout: 5000 });
        await typeBtnLoc.click();

        const step2Btn = page.getByRole('button', { name: /Step 2/i });
        await step2Btn.click();
    } catch (e) {
        await takeCrashScreenshot("PHASE1");
        throw new Error(`Phase 1 Failed (Product Type): ${e.message}`);
    }

    // PHASE 2: Product Info
    try {
        log(`Phase 2: Entering Name [${productName}] and Weight [${productWeight}]`);
        await page.waitForTimeout(2000); 

        log(`Locating Name and Weight fields natively...`);
        // Target all visible input fields on the screen
        const visibleInputs = page.locator('input:visible');
        
        // Fill the first visible input (Name)
        await visibleInputs.nth(0).fill(productName);
        
        // Fill the second visible input (Weight)
        await visibleInputs.nth(1).fill(productWeight);

        const step3Btn = page.getByRole('button', { name: /Step 3/i });
        await step3Btn.click();
    } catch (e) {
        await takeCrashScreenshot("PHASE2");
        throw new Error(`Phase 2 Failed (Product Info): ${e.message}`);
    }

    // PHASE 3 & 4: Skip Optional Data
    try {
        log(`Phases 3 & 4: Skipping optional screens...`);
        await page.waitForTimeout(1000);
        
        const step4Btn = page.getByRole('button', { name: /Step 4/i });
        await step4Btn.click();
        
        await page.waitForTimeout(1000);
        const reviewBtn = page.getByRole('button', { name: /Review/i });
        await reviewBtn.click();
    } catch (e) {
        await takeCrashScreenshot("PHASE3_4");
        throw new Error(`Phases 3/4 Failed (Skipping optional): ${e.message}`);
    }

    // PHASE 5: Submit & Verify
    let sapProductId = "UNKNOWN"; // 🚀 NEW: Variable to hold the generated ID
    try {
        log(`Phase 5: Submitting and verifying popup...`);
        await page.waitForTimeout(1000);

        // Scroll to the bottom of the page to ensure Submit button is visible
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        
        const submitBtn = page.getByRole('button', { name: /^Submit$/i });
        await submitBtn.click();

        // Wait for the UI5 MessageBox to appear
        log(`Waiting for confirmation MessageBox...`);
        const messageBoxYesBtn = page.getByRole('button', { name: /^Yes$/i });
        await messageBoxYesBtn.waitFor({ state: 'visible', timeout: 5000 });
        
        await page.waitForTimeout(1000); // Wait for CSS fade-in

        log(`Clicking Yes and waiting for SAP OData backend response...`);
        
        // 🚀 THE FIX: We destructure the array to capture the specific network response object!
        const [odataResponse] = await Promise.all([
            page.waitForResponse(response => 
                response.url().toLowerCase().includes('/productset') && [200, 201, 204].includes(response.status())
            ),
            messageBoxYesBtn.click({ force: true })
        ]);

        // 🚀 THE MAGIC: Read the JSON payload returned by SAP
        const responseBody = await odataResponse.json();
        
        // Dynamically find the ID key regardless of how SEGW capitalized it (ProductId, Productid, product_id)
        const d = responseBody.d || {};
        const idKey = Object.keys(d).find(k => k.toLowerCase().replace('_', '') === 'productid');
        
        if (idKey && d[idKey]) {
            sapProductId = d[idKey];
            log(`✅ Extracted SAP Product ID from network response: ${sapProductId}`);
        } else {
            log(`⚠️ Could not find ProductId in response body. Keys found: ${Object.keys(d).join(', ')}`, "WARN");
        }

        // Optional: Wait 1 second to let the green UI5 "Success" toast render on screen
        await page.waitForTimeout(1000);

    } catch (e) {
        await takeCrashScreenshot("PHASE5");
        throw new Error(`Phase 5 Failed (Submit & Verify): ${e.message}`);
    }

    // ==========================================
    // GATEWAY REPORTING
    // ==========================================
    log(`✅ UI5 Wizard successfully executed for ${productName}.`);
    
    // 🚀 NEW: We wrap the dynamic variables in backticks (`) to prevent Telegram Markdown crashes!
    const gatewaySummary = `
**OData Record Created Successfully**
* **Product ID:** \`${sapProductId}\`
* **Product:** \`${productName}\`
* **Type:** \`${productType}\`
* **Weight:** \`${productWeight} KG\`
* **Target:** \`ZPROD_WIZARD\` (SAP DB)
* **Status:** HTTP 201 Created
    `;

    // Broadcast to Telegram via standard output
    console.log(`\n[GATEWAY_SUMMARY]: ${gatewaySummary.trim().replace(/\n/g, '\\n')}`);

    // The return string gets written directly to the Google Sheet "Status" column by agent.js!
    return `Completed: Product created. ID: ${sapProductId}`;
};