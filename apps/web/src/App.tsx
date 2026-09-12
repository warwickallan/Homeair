import { useEffect, useState } from "react";
import type { HealthResponse } from "@homeair/shared";
import { api } from "./api";
import { Live } from "./Live";
import { Simulator } from "./Simulator";

/** Hash routing: `#/` live WhatsApp (the product), `#/simulator` paste mode. */
export function App() {
  const [route, setRoute] = useState(window.location.hash);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const load = () => api.health().then(setHealth).catch(() => setHealth(null));
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (route.startsWith("#/simulator")) return <Simulator health={health} />;
  return <Live health={health} />;
}
