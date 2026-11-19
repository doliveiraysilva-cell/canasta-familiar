# Canasta Familiar: cómo ponerla en marcha

Todo es gratis. Se tarda unos 15 minutos y se hace una sola vez.

## 1. La base de datos (Supabase)

1. Entrá a https://supabase.com y tocá **Start your project**. Podés entrar con tu cuenta de GitHub o de Google.
2. Tocá **New project**. Ponele de nombre `canasta-familiar`. Elegí la región **South America (São Paulo)** y tocá **Generate a password**. No hace falta que guardes esa contraseña. Después tocá **Create new project** y esperá un par de minutos.
3. En el menú de la izquierda, entrá a **SQL Editor**. Pegá todo el contenido de `supabase/schema.sql` y tocá **Run**. Tiene que aparecer "Success".
4. Entrá a **Authentication** > **Sign In / Providers** > **Email** y desactivá **Confirm email**. Después tocá **Save**. Así nadie de la familia tiene que confirmar un email para entrar.

## 2. La lectura automática de tickets (gratis con Gemini)

1. Entrá a https://aistudio.google.com/apikey con tu cuenta de Google y tocá **Create API key**. Copiá la clave.
2. En Supabase, entrá a **Edge Functions** > **Secrets**. Agregá un secreto con nombre `GEMINI_API_KEY` y pegá la clave como valor.
3. En **Edge Functions** > **Functions** tocá **Deploy a new function** > **Via Editor**. Ponele de nombre `leer`, borrá el código de ejemplo y pegá todo `supabase/functions/leer/index.ts`. Después tocá **Deploy function**.

Si en algún momento preferís usar Claude en lugar de Gemini, cargá el secreto `ANTHROPIC_API_KEY` y borrá `GEMINI_API_KEY`. Claude es pago, pero cada ticket cuesta centavos.

## 3. Mandame dos datos

En Supabase, entrá a **Project Settings** > **Data API** (o **API**) y copiá:
- **Project URL**, que empieza con `https://` y termina en `.supabase.co`.
- La clave **anon public**, que es un texto largo que empieza con `eyJ`.

Las dos son públicas por diseño y se pueden mandar por el chat. **No** mandes la clave `service_role` ni la de Gemini.

## 4. La dirección web (GitHub Pages)

En https://github.com/new creá un repositorio **público** llamado `canasta-familiar`, vacío y sin README. Avisame cuando esté. Yo subo la app y la publico en `https://doliveiraysilva-cell.github.io/canasta-familiar/`.

## 5. Sumar a la familia

1. Vos entrás primero con **Crear cuenta**, y quedás como administrador principal.
2. En la pestaña **Familia** vas a ver el **código familiar**. Pasale a cada persona el link y el código.
3. Cada persona toca **Crear cuenta** con su email y una contraseña, y después escribe el código. Si la empleada no tiene email, puede usar uno inventado, por ejemplo `empleada@casa.com`, siempre que recuerde la contraseña.
4. Para que tu esposa pueda cargar promos, tocá **Hacer admin** al lado de su nombre.
5. En el celular, desde el menú del navegador, toquen **Agregar a pantalla de inicio** para tenerla como app.
