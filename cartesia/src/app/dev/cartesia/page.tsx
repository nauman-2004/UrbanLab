/**
 * /dev/cartesia : DEVELOPMENT DEMO ROUTE. Not part of production navigation.
 *
 * Server component: decides which modes are available from server-only env and
 * passes the client nothing but booleans. The API key never leaves the server.
 */
import { CartesiaDemo } from "@cartesia/demo/CartesiaDemo";
import { MOCK_SCENARIOS, type MockScenario } from "@cartesia/mock/demo-transcript";
import { readServerConfig, serverMode } from "@cartesia/server/session";

export default async function CartesiaDevPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const cfg = readServerConfig();
  const liveAvailable = serverMode() === "live" && cfg.ok;
  const liveUnavailableReason = serverMode() !== "live" ? "CARTESIA_DEMO_MODE is not set to live." : cfg.ok ? null : cfg.error.message;

  // ?mode=mock forces the fallback even when live is configured; live can't be forced without server config.
  const wantMock = params.mode === "mock";
  const scenarioParam = typeof params.scenario === "string" ? params.scenario : "happy";
  const scenario = (MOCK_SCENARIOS.some((s) => s.id === scenarioParam) ? scenarioParam : "happy") as MockScenario;

  return (
    <CartesiaDemo
      initialMode={liveAvailable && !wantMock ? "live" : "mock"}
      liveAvailable={liveAvailable}
      liveUnavailableReason={liveUnavailableReason}
      initialScenario={scenario}
    />
  );
}
