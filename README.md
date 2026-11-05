# Simpla

Simpla es la app personal de Federico para seguir los gastos en Argentina: la tarjeta y sus cuotas, los préstamos, los servicios (con el aumento que se viene) y las suscripciones, con una mirada a los próximos 6 meses.

Por ahora es el esqueleto: se ve el diseño, pero todavía no carga datos. Se adapta al modo claro u oscuro del sistema y, después de la primera visita, abre aunque no haya internet. Las fuentes van en el repositorio (Bricolage Grotesque e Instrument Serif, licencia OFL), así el texto también carga sin conexión. El acceso con Google y la base están en `SUPABASE.md`.

## Instalar

Dirección: https://fedeguastadisegni.github.io/Simpla/

### En el celular (Chrome, Android)

1. Abrí el enlace en Chrome.
2. Tocá el menú ⋮ y elegí **Instalar app**. Según la versión, puede decir **Agregar a la pantalla principal**.
3. Confirmá. El ícono de Simpla queda en el inicio.

### En la notebook (Chrome)

1. Abrí el enlace en Chrome.
2. A la derecha de la barra de direcciones, tocá **Instalar** (una pantalla con una flecha).
3. Si no aparece ese ícono: menú ⋮ → **Transmitir, guardar y compartir** → **Instalar página como app…**.
4. Confirmá. Se abre en su propia ventana.

## Publicación

Cada push a `main` publica el sitio con GitHub Actions.

Si la página no aparece, en el repositorio entrá a **Settings → Pages → Build and deployment → Source** y elegí **GitHub Actions**. Sin ese origen, el workflow no tiene dónde publicar. Si el primer intento falló antes de cambiar esa opción, volvé a correr **Deploy GitHub Pages** desde la pestaña Actions.
