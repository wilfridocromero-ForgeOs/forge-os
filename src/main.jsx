import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";

import "./index.css";

import { AuthProvider } from "./Context/AuthContext";
import { OrganizationProvider } from "./core/OrganizationContext";

ReactDOM.createRoot(
  document.getElementById("root")
).render(
  <React.StrictMode>

    <BrowserRouter>

      <AuthProvider>

        <OrganizationProvider>

          <App />

        </OrganizationProvider>

      </AuthProvider>

    </BrowserRouter>

  </React.StrictMode>
);