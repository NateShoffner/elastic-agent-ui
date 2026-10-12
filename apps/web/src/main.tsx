import { StrictMode, useEffect, useSyncExternalStore } from "react";
import type { Health } from "@eaui/shared";
import { createRoot } from "react-dom/client";
import { EuiEmptyPrompt, EuiLoadingSpinner, EuiProvider } from "@elastic/eui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { UnauthorizedError, useBridgeEvents, useSnapshot } from "./api";
import { Layout } from "./components/Layout";
import { setFaviconHealth } from "./favicon";
import { CONNECTION_HEALTH, HEALTH_LABEL } from "./health";
import { Components } from "./pages/Components";
import { Logs } from "./pages/Logs";
import { Overview } from "./pages/Overview";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: (n, err) => !(err instanceof UnauthorizedError) && n < 3 } } });

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function useColorMode(): "dark" | "light" {
  return useSyncExternalStore(
    (cb) => (darkQuery.addEventListener("change", cb), () => darkQuery.removeEventListener("change", cb)),
    () => (darkQuery.matches ? "dark" : "light"),
  );
}

function App() {
  const snapshot = useSnapshot();
  const streamOpen = useBridgeEvents();

  // Tab icon and title reflect the agent's health, so a background tab still shows when something's wrong.
  const data = snapshot.data;
  const health: Health | null = !data
    ? null
    : data.connection.status !== "connected"
      ? CONNECTION_HEALTH[data.connection.status]
      : (data.agent?.health ?? null);
  useEffect(() => {
    setFaviconHealth(health);
    document.title = health && health !== "healthy" ? `${HEALTH_LABEL[health]} · Elastic Agent` : "Elastic Agent";
  }, [health]);

  if (snapshot.error instanceof UnauthorizedError) {
    return (
      <EuiEmptyPrompt
        iconType="lock"
        title={<h2>Not signed in</h2>}
        body={
          <p>
            Open the link the bridge printed when it started. It contains a token that's only valid until the bridge
            stops, so after restarting the bridge you need its new link.
          </p>
        }
      />
    );
  }
  if (snapshot.error) {
    return <EuiEmptyPrompt iconType="error" color="danger" title={<h2>Can't reach the bridge</h2>} body={<p>{snapshot.error.message}</p>} />;
  }
  if (!snapshot.data) {
    return <EuiEmptyPrompt icon={<EuiLoadingSpinner size="xl" />} title={<h2>Connecting…</h2>} />;
  }

  return (
    <Layout snapshot={snapshot.data} streamOpen={streamOpen}>
      <Routes>
        <Route path="/" element={<Overview snapshot={snapshot.data} />} />
        <Route path="/components" element={<Components snapshot={snapshot.data} />} />
        <Route path="/logs" element={<Logs snapshot={snapshot.data} />} />
      </Routes>
    </Layout>
  );
}

function Root() {
  const colorMode = useColorMode();
  return (
    <EuiProvider colorMode={colorMode}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </EuiProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
