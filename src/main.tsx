import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app";
import { initializeTelegramWebApp } from "./telegram";
import "./index.css";

const webApp = initializeTelegramWebApp();
const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Mini App root element is missing");
}

createRoot(rootElement).render(
  <StrictMode>
    <App webApp={webApp} />
  </StrictMode>,
);
