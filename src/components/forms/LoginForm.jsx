import { useState } from "react";
import { useNavigate } from "react-router-dom";

import EmailInput from "./EmailInput";
import PasswordInput from "./PasswordInput";

import Button from "../actions/Button";
import ErrorMessage from "../feedback/ErrorMessage";

import { supabase } from "../../lib/supabase";

export default function LoginForm() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e) {
    e.preventDefault();

    setError("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError("Correo o contraseña incorrectos.");
      return;
    }

    navigate("/");
  }

  return (
    <form
      onSubmit={handleLogin}
      className="space-y-6"
    >
      <EmailInput
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <PasswordInput
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error && (
        <ErrorMessage>
          {error}
        </ErrorMessage>
      )}

      <Button
        loading={loading}
        type="submit"
      >
        Continuar
      </Button>
    </form>
  );
}