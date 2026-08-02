# Auditoría técnica de ORVESEN

Fecha: 2 de agosto de 2026

## Resultado ejecutivo

El proyecto compila correctamente para producción después de corregir el flujo crítico de autenticación. El registro anterior mezclaba la creación de una identidad de Supabase Auth con la provisión de datos internos desde el navegador. Cuando la confirmación por correo estaba activa, `signUp` devolvía un usuario pero ninguna sesión; las inserciones posteriores en `organizations` y `users` se ejecutaban como `anon`, por lo que podían fallar por RLS y dejar una cuenta incompleta.

La corrección separa ambos procesos: el frontend registra la identidad, envía los datos iniciales como metadata y respeta el estado `session === null`. La creación atómica de organización y perfil debe residir en una función/trigger de base de datos o en un RPC controlado. Ese segundo tramo no puede verificarse porque el proyecto entregado no incluye migraciones, definición de tablas ni políticas RLS.

## Archivos revisados y cambios

### `package.json` y `package-lock.json`

- React 19, React Router 7, Vite 8 y Supabase JS 2 son compatibles con el patrón usado.
- Existe lockfile y la compilación resolvió 1.865 módulos.
- Las dependencias usan rangos con `^`; el lockfile fija la instalación actual, pero conviene evitar actualizarlo accidentalmente sin pruebas.

### `vite.config.js`

- Configuración mínima válida: React y Tailwind están registrados una sola vez.
- No se detectaron alias ni transformaciones que alteren los imports de autenticación.

### `.env` y `.gitignore`

- Están presentes los nombres correctos: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
- `.env` está ignorado por Git.
- Se añadió `.env.example` sin credenciales.
- El ZIP original incluyó `.env`; debe evitarse al compartir el proyecto.

### `src/lib/supabase.js`

- Antes: creaba el cliente aunque faltaran variables y escribía la URL del proyecto en consola.
- Ahora: valida ambas variables antes de arrancar, elimina el log y declara de forma explícita persistencia, renovación de token y detección de sesión en URL.
- Solo existe una instancia activa del cliente, exportada como `supabase`.
- Hallazgo menor: `src/testConnection.js` usa un import default inexistente. No forma parte del grafo de producción, pero debe corregirse o eliminarse antes de utilizarlo.

### `src/Context/AuthContext.jsx`

- Mantiene una única suscripción a `onAuthStateChange` y la cancela al desmontar.
- La restauración con `getSession` ahora maneja errores y siempre libera el estado de carga.
- El listener también libera `loading`, evitando una pantalla bloqueada si el evento inicial llega antes que la promesa.
- `useAuth` ahora falla con un mensaje claro cuando se usa fuera del proveedor.

### `src/routes/ProtectedRoute.jsx`

- Espera la restauración de sesión antes de decidir.
- Conserva la ruta solicitada al enviar al usuario a `/login`.

### `src/routes/PublicOnlyRoute.jsx`

- Archivo nuevo.
- Impide que una persona ya autenticada vuelva a `/login` o `/register`.
- Evita el parpadeo de las pantallas públicas durante la restauración de sesión.

### `src/components/forms/LoginForm.jsx`

- Normaliza el correo con `trim()`.
- Distingue correo no confirmado de credenciales incorrectas.
- Maneja fallos de conexión y garantiza que el botón deje de cargar mediante `finally`.
- Tras iniciar sesión vuelve a la ruta protegida solicitada, no siempre al dashboard.

### `src/auth/Login.jsx`

- El enlace de recuperación era un botón sin acción y conducía a un flujo inexistente: `ForgotPassword.jsx` está vacío y no hay ruta asociada.
- Se sustituyó por un enlace funcional hacia registro.

### `src/auth/Register.jsx`

- Causa crítica eliminada: ya no inserta `organizations` ni `users` desde una sesión inexistente o desde el cliente público.
- Envía `first_name` y `organization_name` como metadata de registro para que una provisión segura del lado de base de datos pueda consumirlos.
- Si Supabase crea una sesión inmediata, navega al dashboard.
- Si la confirmación por correo está activa, muestra una confirmación y no intenta entrar a rutas protegidas.
- Se añadieron validación nativa, contraseña mínima de ocho caracteres, estados de éxito/error y enlace a login.
- Se eliminaron logs que exponían objetos de autenticación en la consola.

### `src/App.jsx` y `src/main.jsx`

- `BrowserRouter` existe una sola vez y envuelve a los proveedores.
- Las rutas públicas ahora están bajo `PublicOnlyRoute`; las privadas permanecen bajo `ProtectedRoute`.
- `vercel.json` ya incluye la reescritura necesaria para rutas SPA.
- No existen rutas para recuperación/restablecimiento pese a haber archivos vacíos con esos nombres.

### `src/Context/OrganizationContext.jsx`

- Consulta la tabla `users` y su relación con `organizations` después de autenticar.
- Riesgo pendiente: usa `.single()`, por lo que un usuario confirmado sin perfil genera error. Esto confirma que la provisión de perfil debe ser atómica en base de datos.
- No se cambió sin conocer tablas, restricciones y RLS.

### Duplicados y conflictos arquitectónicos

- Existen dos implementaciones incompatibles de `OrganizationContext`: `src/Context/OrganizationContext.jsx` usa Supabase y `src/core/OrganizationContext.jsx` usa datos simulados.
- Hay servicios solapados: `ClientService.js`, `clients.js` y `features/clients/services/clientsService.js`.
- Hay dos servicios de puntuación: `ScoreService.js` y `score.js`.
- Hay componentes duplicados entre `components/ui`, `components/business`, `design/components` y `features` (por ejemplo `ClientCard`, `OrvesenScore`, `CategoryCard`, `PageHeader`).
- `Loarder.jsx` parece un error de nombre.
- Estos duplicados no se eliminaron automáticamente porque varios representan variantes visuales y hace falta decidir cuál es la API canónica.

## Verificación

- `vite build`: correcto.
- Salida: `dist/index.html`, CSS y bundle JavaScript generados correctamente.
- `eslint .`: 13 errores y 1 advertencia preexistentes fuera del flujo crítico.

Errores relevantes pendientes:

- Regla de Fast Refresh en cinco archivos que mezclan providers y hooks.
- Actualizaciones de estado disparadas desde efectos en `app/Clients.jsx` y `features/clients/hooks/useClients.js`.
- Import sin usar de `Badge` en `MetricCard.jsx`.
- Cinco widgets utilizan `BaseWidget` sin importarlo.

## Bloqueo de base de datos

No se puede certificar el registro extremo a extremo ni corregir RLS sin alguno de estos elementos:

- migraciones SQL de Supabase;
- definición de `organizations` y `users`;
- triggers existentes sobre `auth.users`;
- políticas RLS y grants;
- acceso conectado al proyecto Supabase.

La siguiente intervención debe crear o verificar una operación atómica del lado de base de datos que, al confirmarse un usuario, cree su organización, cree su perfil y asigne la relación sin confiar en metadata para autorización.
