import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";


const ThemeContext =
  createContext(null);


export function ThemeProvider({
  children,
}) {
  const [theme, setTheme] =
    useState(() => {
      return (
        localStorage.getItem(
          "orvesen-theme"
        ) || "dark"
      );
    });


  useEffect(() => {
    const root =
      document.documentElement;

    /*
    ==========================================
    RESOLVER TEMA
    ==========================================
    */

    const systemPrefersDark =
      window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;


    const resolvedTheme =
      theme === "system"
        ? systemPrefersDark
          ? "dark"
          : "light"
        : theme;


    /*
    ==========================================
    CLASE DARK PARA TAILWIND
    ==========================================
    */

    root.classList.toggle(
      "dark",
      resolvedTheme === "dark"
    );


    /*
    ==========================================
    DATA THEME
    ==========================================
    */

    root.dataset.theme =
      resolvedTheme;


    /*
    ==========================================
    COLOR SCHEME DEL NAVEGADOR
    ==========================================
    */

    root.style.colorScheme =
      resolvedTheme;


    /*
    ==========================================
    GUARDAR PREFERENCIA
    ==========================================
    */

    localStorage.setItem(
      "orvesen-theme",
      theme
    );

  }, [theme]);


  /*
  ==========================================
  SEGUIR CAMBIOS DEL SISTEMA
  ==========================================
  */

  useEffect(() => {
    if (theme !== "system") {
      return;
    }


    const media =
      window.matchMedia(
        "(prefers-color-scheme: dark)"
      );


    function handleSystemChange(
      event
    ) {
      const root =
        document.documentElement;


      const resolvedTheme =
        event.matches
          ? "dark"
          : "light";


      root.classList.toggle(
        "dark",
        resolvedTheme === "dark"
      );


      root.dataset.theme =
        resolvedTheme;


      root.style.colorScheme =
        resolvedTheme;
    }


    media.addEventListener(
      "change",
      handleSystemChange
    );


    return () => {
      media.removeEventListener(
        "change",
        handleSystemChange
      );
    };

  }, [theme]);


  /*
  ==========================================
  CAMBIAR TEMA
  ==========================================
  */

  function changeTheme(
    nextTheme
  ) {
    if (
      ![
        "light",
        "dark",
        "system",
      ].includes(nextTheme)
    ) {
      return;
    }

    setTheme(nextTheme);
  }


  /*
  ==========================================
  TOGGLE SIMPLE
  ==========================================
  */

  function toggleTheme() {
    setTheme(
      (current) =>
        current === "dark"
          ? "light"
          : "dark"
    );
  }


  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme:
          changeTheme,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}


export function useTheme() {
  const context =
    useContext(
      ThemeContext
    );


  if (!context) {
    throw new Error(
      "useTheme debe utilizarse dentro de ThemeProvider."
    );
  }


  return context;
}