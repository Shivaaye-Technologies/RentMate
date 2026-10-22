import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { checkHealth } from "./api";
import { App } from "./App";
import "./styles.css";

// Free hosting puts the API to sleep when idle. Ping it on load so it is
// awake by the time the user reaches Discover.
void checkHealth();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
