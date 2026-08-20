import React from "react";
import ReactDOM from "react-dom/client";

import {
  BrowserRouter
} from "react-router-dom";

import App from "./App";

import "./index.css";

import {
  AuthProvider
} from "./Context/AuthContext";

import {
  OrganizationProvider
} from "./Context/OrganizationContext";
import { ThemeProvider } from "./Context/ThemeContext";
import { installVersionGuard } from "./versionGuard";

const savedTheme = localStorage.getItem("orvesen-theme") || "dark";
document.documentElement.dataset.theme = savedTheme;
document.documentElement.style.colorScheme = savedTheme;
installVersionGuard();


ReactDOM.createRoot(
  document.getElementById("root")
).render(

  <React.StrictMode>

    <BrowserRouter>

      <ThemeProvider>

      <AuthProvider>

        <OrganizationProvider>

          <App />

        </OrganizationProvider>

      </AuthProvider>

      </ThemeProvider>

    </BrowserRouter>

  </React.StrictMode>

);
