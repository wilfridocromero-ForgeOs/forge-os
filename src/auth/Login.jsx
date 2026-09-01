import { useEffect, useState } from "react";

import Logo from "../components/display/Logo";
import LoginForm from "../components/forms/LoginForm";
import AuthBackground from "../components/display/AuthBackground";
import "./Login.css";

const lightPoints = Array.from({ length: 9 }, (_, index) => index);

export default function Login() {
  const [motionReady, setMotionReady] = useState(false);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setMotionReady(true));
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, []);

  return (
    <main className={`login-experience${motionReady ? " is-motion-ready" : ""} relative min-h-screen w-full overflow-x-hidden overflow-y-auto bg-[#09090B] px-4 py-5 sm:px-6 sm:py-8`}>
      <AuthBackground />

      <div className="login-ambient" aria-hidden="true">
        <div className="login-orbit login-orbit--outer" />
        <div className="login-orbit login-orbit--inner" />
        <div className="login-thread login-thread--one" />
        <div className="login-thread login-thread--two" />
        <div className="login-points">
          {lightPoints.map((point) => (
            <span className={`login-point login-point--${point + 1}`} key={point} />
          ))}
        </div>
      </div>

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-4xl items-center sm:min-h-[calc(100vh-4rem)]">
        <div className="login-shell grid w-full overflow-hidden rounded-3xl border border-zinc-800 bg-[#111113]/85 shadow-[0_30px_90px_rgba(0,0,0,.45)] backdrop-blur-xl lg:grid-cols-[0.9fr_1.1fr]">
          <section className="login-brand flex items-center justify-center border-b border-zinc-800 px-6 py-7 sm:px-10 lg:border-b-0 lg:border-r lg:py-12">
            <div className="w-full max-w-sm">
              <Logo />
              <p className="mt-6 hidden text-center text-sm leading-6 text-zinc-500 lg:block">
                Inteligencia empresarial para entender, organizar y hacer crecer tu empresa.
              </p>
            </div>
          </section>

          <section className="login-form-panel min-w-0 px-6 py-7 sm:px-10 sm:py-10 lg:px-12 lg:py-12">
            <div className="mx-auto w-full max-w-md">
              <div className="text-center lg:text-left">
                <h2 className="text-2xl font-semibold text-white">Bienvenido nuevamente</h2>
                <p className="mt-3 text-sm leading-6 text-zinc-500">
                  Inicia sesión para acceder a tu espacio de trabajo y continuar gestionando tu empresa.
                </p>
              </div>

              <div className="mt-7">
                <LoginForm />
              </div>

              <div className="mt-7 flex items-center justify-between border-t border-zinc-800 pt-5 text-sm">
                <span className="text-zinc-500">¿Necesitas acceso?</span>
                <span className="font-medium text-white">Solicita una invitación</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
