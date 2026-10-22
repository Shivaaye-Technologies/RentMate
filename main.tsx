import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { checkHealth, type HealthState } from "./api";
import "./styles.css";

function App() {
  const [health, setHealth] = useState<HealthState>("checking");

  useEffect(() => {
    void checkHealth().then(setHealth);
  }, []);

  return (
    <main className="shell">
      <h1>SOULMATE.AI</h1>
      <p className="tagline">Meaningful matches, powered by shared interests.</p>
      <p className={`status status-${health}`}>API: {health}</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
