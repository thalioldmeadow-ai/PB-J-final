/**
 * Configuration and provider check.
 *
 *   npm run ai:check              what is configured and enabled
 *   npm run ai:models             ask each configured provider for its live models
 *   npx tsx scripts/ai-check.ts --live "hello"   send one real request
 *
 * Nothing here invents a result: without a key it reports that a provider is
 * unavailable, and --live only runs when a provider is actually enabled.
 */

import { formatModelRef, loadAiConfig } from "../server/ai/config";
import { listModels } from "../server/ai/providers";
import { chat } from "../server/ai/service";
import { summariseUsage } from "../server/ai/usage";

const args = process.argv.slice(2);
const wantsModels = args.includes("--models");
const liveIndex = args.indexOf("--live");
const livePrompt = liveIndex >= 0 ? args[liveIndex + 1] || "Say hello in one short sentence." : undefined;

const pad = (value: string, width: number) => value.padEnd(width, " ");

const main = async () => {
  const config = loadAiConfig();

  console.log("\nAI configuration");
  console.log("  enabled        ", config.enabled);
  console.log("  streaming      ", config.streaming);
  console.log("  default model  ", formatModelRef(config.defaultModel) || "(none)");
  console.log("  backup model   ", formatModelRef(config.backupModel) || "(none)");
  console.log("  provider order ", config.order.join(" -> ") || "(none)");
  console.log("  validate models", config.validateModels);
  console.log(
    "  limits         ",
    `global ${config.limits.requestsPerDay}/day, ${config.limits.tokensPerDay} tokens/day, $${config.limits.costPerMonthUsd}/month, ${config.limits.requestsPerMinutePerClient}/min and ${config.limits.requestsPerDayPerClient}/day per client`,
  );

  console.log("\nProviders");
  for (const provider of config.providers) {
    const state = provider.enabled ? "enabled" : "disabled";
    console.log(`  ${pad(provider.label, 13)} ${pad(state, 9)} ${provider.disabledReason || ""}`);
    for (const model of provider.models) {
      console.log(`      model ${pad(model.id, 22)} ${provider.limits.maxOutputTokens} max out, ${provider.limits.requestsPerDay}/day`);
    }
    if (provider.pinnedProvider) {
      console.log(`      pinned upstream provider: ${provider.pinnedProvider}`);
    }
  }

  if (wantsModels) {
    const targets = config.providers.filter((provider) => provider.keyPresent);
    if (targets.length === 0) {
      console.log("\nNo provider key is set, so there is no live model list to fetch.");
    }
    for (const provider of targets) {
      console.log(`\nLive models: ${provider.label}`);
      try {
        const models = await listModels(provider);
        console.log(`  ${models.length} models returned`);
        for (const entry of models.slice(0, 40)) console.log(`    ${entry.id}`);
        for (const model of provider.models) {
          const found = models.some((entry) => entry.id === model.id);
          console.log(`  configured ${model.id}: ${found ? "available" : "NOT in the live list"}`);
        }
      } catch (error) {
        console.log(`  could not fetch: ${(error as Error).message}`);
      }
    }
  }

  console.log("\nUsage");
  const usage = summariseUsage();
  console.log(
    `  today ${usage.today.requests} requests, ${usage.today.inputTokens + usage.today.outputTokens} tokens, $${usage.today.costUsd}`,
  );
  console.log(`  month $${usage.thisMonth.costUsd} of $${config.limits.costPerMonthUsd}`);
  for (const [provider, totals] of Object.entries(usage.byProvider)) {
    console.log(`  ${pad(provider, 13)} ${totals.requests} requests, $${totals.costUsd}`);
  }

  if (livePrompt) {
    console.log("\nLive request");
    if (!config.enabled) {
      console.log("  skipped: no provider is enabled, so there is nothing to call.");
      return;
    }
    try {
      const result = await chat({ message: livePrompt, ageBand: "adult" });
      console.log(`  provider ${result.provider} (${result.model}), fell back: ${result.fellBack}`);
      console.log(`  tokens ${result.usage.inputTokens} in / ${result.usage.outputTokens} out, $${result.usage.costUsd.toFixed(6)}`);
      console.log(`  reply: ${result.reply.slice(0, 200)}`);
    } catch (error) {
      console.log(`  failed: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
