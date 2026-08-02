import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import EmailInput from "./EmailInput";
import PasswordInput from "./PasswordInput";

import Button from "../actions/Button";
import ErrorMessage from "../feedback/ErrorMessage";

import { supabase } from "../../lib/supabase";

export default function LoginForm() {
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        setError(
          authError.message === "Email not confirmed"
            ? "Confirma tu correo antes de iniciar sesión."
            : "Correo o contraseña incorrectos.",
        );
        return;
      }

      const destination = location.state?.from?.pathname ?? "/";
      navigate(destination, { replace: true });
    } catch {
      setError("No fue posible conectar con el servicio de autenticación.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleLogin} className="space-y-6">
      <EmailInput
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <PasswordInput
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      {error && <ErrorMessage>{error}</ErrorMessage>}

      <Button loading={loading} type="submit">
        Continuar
      </Button>
    </form>
  );
}
