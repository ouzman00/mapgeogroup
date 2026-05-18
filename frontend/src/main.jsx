import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { installChunkLoadGuards } from "./utils/lazyWithRetry";
import "leaflet/dist/leaflet.css";
import "./styles/globals.css";

installChunkLoadGuards();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);