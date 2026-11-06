# Simpla

Simpla es una aplicación web personal para organizar las finanzas del día a día en Argentina y anticipar compromisos de los próximos seis meses.

La aplicación ya cuenta con persistencia y sincronización: permite registrar tarjetas y consumos en cuotas, préstamos, servicios, facturas y suscripciones; consultar proyecciones y próximos vencimientos; e importar consumos de resúmenes de tarjeta.

## Funcionalidades

- **Tarjetas:** tarjetas, consumos, cuotas y fechas de cierre.
- **Préstamos:** seguimiento de cuotas y proyecciones de amortización.
- **Servicios y suscripciones:** registro de importes, períodos y próximos cargos.
- **Gastos diarios:** estructura de datos preparada; la pantalla de carga y la captura automática están pendientes.
- **Proyecciones:** vista combinada de compromisos y vencimientos para los próximos seis meses.
- **Importación:** lectura de formatos de resumen de Tarjeta de Crédito VISA y Tarjeta de Crédito MasterCard desde PDF, además de importación desde imágenes. Otros diseños de resumen pueden requerir ajustes del lector.
- **Alertas:** próximos pagos y cambios relevantes.
- **Respaldo:** exportación e importación de copias de seguridad en JSON.

## Cómo funciona

Simpla es una PWA construida con HTML, CSS y JavaScript nativo, sin framework de frontend ni proceso de compilación.

La aplicación mantiene datos en IndexedDB en el navegador y utiliza una cola local para conservar cambios cuando no hay conexión. Al recuperar conectividad, sincroniza esos cambios con Supabase. El acceso se realiza con Google y los permisos de datos se controlan en la base mediante Row Level Security (RLS).

El modo sin conexión permite volver a abrir la aplicación y trabajar con los datos locales. La sincronización con la nube requiere conexión a internet.

## Usar Simpla

Aplicación publicada: https://fedeguastadisegni.github.io/Simpla/

### En Android (Chrome)

1. Abrí el enlace en Chrome.
2. Abrí el menú ⋮ y elegí **Instalar app** o **Agregar a la pantalla principal**.
3. Confirmá. Simpla aparecerá junto con tus otras aplicaciones.

### En una notebook o computadora (Chrome)

1. Abrí el enlace en Chrome.
2. Seleccioná **Instalar** en la barra de direcciones, si aparece.
3. Como alternativa, abrí el menú ⋮ y elegí **Transmitir, guardar y compartir → Instalar página como app…**.

## Desarrollo local

No hace falta instalar dependencias de frontend. Para servir la aplicación localmente, desde la raíz del repositorio podés ejecutar:

\`\`\`bash
python -m http.server 8000
\`\`\`

Después abrí http://localhost:8000.

Para probar el inicio de sesión local, la URL local también debe estar permitida en la configuración de URLs de autenticación de Supabase. La configuración del proyecto está en \`config.js\`; no agregues claves secretas ni una \`service_role\` key al código del navegador.

## Pruebas

Los tests usan el runner nativo de Node.js y no requieren dependencias adicionales. Con Node.js 22 o superior, ejecutá:

\`\`\`bash
npm test
\`\`\`

GitHub Actions ejecuta esta misma suite en cada pull request hacia \`main\`, en cada push a \`main\` y manualmente desde la pestaña **Actions**. El workflow de tests no publica el sitio.

## Publicación

Cada push a \`main\` publica el sitio mediante el workflow **Deploy GitHub Pages**. Los pull requests ejecutan las pruebas, pero no despliegan la aplicación.

Si la página no aparece, en el repositorio entrá a **Settings → Pages → Build and deployment → Source** y elegí **GitHub Actions**.

## Documentación de Supabase

La configuración de autenticación, base de datos y políticas de acceso está documentada en [SUPABASE.md](SUPABASE.md).

## Períodos de tarjeta

Los compromisos se agrupan por mes de pago: un resumen con cierre en octubre y vencimiento en noviembre integra los fijos de noviembre. La fecha original de compra y el vencimiento de la cuota indicada se guardan por separado. Las compras posteriores al cierre se estiman para el siguiente período; al importar se confirman las fechas reales.

La revisión permite corregir cierre y vencimiento antes de confirmar. Una cuota en curso cargada manualmente requiere indicar su vencimiento. Los consumos antiguos sin período se mantienen y se señalan como estimados: reimportá el resumen o editá la fecha para confirmarlos.

Los documentos se procesan en memoria en el navegador. No se guardan ni se suben PDF, imágenes o el texto completo extraído: solo se persisten los registros confirmados y las fechas necesarias para proyectarlos.

El modelo admite vínculos opcionales entre consumos y suscripciones o facturas. La clasificación en la revisión de importación y la anticipación de cargos recurrentes se implementarán en una siguiente etapa.
