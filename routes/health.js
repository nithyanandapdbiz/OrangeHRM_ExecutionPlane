'use strict';
const path           = require('path');
const AlmClient      = require('../clients/alm.client');
const IntelClient    = require('../clients/intelligence.client');
const { checkInstalled } = require('../runners/playwright.runner');
const config         = require('../config/customer.json'); // tenant identity — no hardcoding

module.exports = (app) => {
  app.get('/health', async (_req, res) => {
    const platformDir = path.resolve(process.env.PLATFORM_DIR || config.platformDir || '../AgenticQAPlatform');

    // Run connectivity probes concurrently
    const [almStatus, intelStatus, pwStatus] = await Promise.all([
      (async () => {
        try { return await new AlmClient().checkConnectivity(); }
        catch (e) { return { connected: false, error: e.message, tracker: {}, testManagement: {} }; }
      })(),
      (async () => {
        try { return await new IntelClient().checkHealth(); }
        catch (e) { return { reachable: false, error: e.message }; }
      })(),
      checkInstalled(),
    ]);

    res.json({
      status:    'ok',
      plane:     'Customer Execution Plane',
      customer:  process.env.CUSTOMER_ID || config.customerId,
      domain:    config.domain,
      sovereign: {
        aiCredentialPresent: false, // provider-agnostic: EP holds no AI credential of any provider
        piiScrubberActive:   true,
        clientCredentialsPresent: !!(process.env.CLIENT_ID && process.env.CLIENT_SECRET),
      },
      jira: {
        baseUrl:   process.env.JIRA_BASE_URL,
        project:   process.env.JIRA_PROJECT_KEY,
        connected: almStatus.tracker?.connected ?? almStatus.connected,
        status:    almStatus.tracker?.status ?? almStatus.status,
        error:     almStatus.tracker?.error ?? almStatus.error ?? null,
      },
      zephyr: {
        apiUrl:    process.env.ZEPHYR_API_URL || 'https://api.zephyrscale.smartbear.com/v2',
        connected: almStatus.testManagement?.connected ?? false,
        status:    almStatus.testManagement?.status ?? null,
        error:     almStatus.testManagement?.error ?? null,
      },
      intelligenceApi: {
        url:       process.env.INTELLIGENCE_API_URL || 'http://localhost:3001',
        reachable: intelStatus.reachable,
        agents:    intelStatus.data?.agents ?? null,
        aiActive:  intelStatus.data?.aiActive ?? null,
        error:     intelStatus.error ?? null,
      },
      playwright: {
        installed:   pwStatus.installed,
        version:     pwStatus.version ?? null,
        platformDir,
        error:       pwStatus.error ?? null,
      },
    });
  });
};
