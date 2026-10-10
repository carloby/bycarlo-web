# bycarlo-web

Web de [bycarlo.es](https://bycarlo.es): una sola página con el agente **AiCarlo** arriba y, debajo, casos, paquetes, tienda y contacto.

## Qué hay

| Carpeta o archivo | Qué es |
|---|---|
| `public/index.html` | La página: textos, casos, paquetes y contacto |
| `public/styles.css` | Estilos. El color de acento se cambia en `--accent` y `--on-accent` |
| `public/app.js` | El chat: sugerencias con respuesta ya escrita, tarjetas y envío del resumen |
| `netlify/functions/chat/instrucciones.mts` | **Cómo habla AiCarlo y qué ofrece.** Es lo que más vas a tocar |
| `netlify/functions/chat/index.mts` | La función que habla con el modelo (`/api/chat`) y sus límites |
| `public/privacidad.html`, `public/aviso-legal.html` | Esquemas pendientes de redactar |
| `netlify.toml` | Configuración de Netlify |

No hay paso de compilación: Netlify publica la carpeta `public` tal cual y despliega la función.

## Cómo funciona el chat

- **Sugerencias** («Quiero una web que venda»…): la respuesta está escrita en `CANNED`, dentro de `public/app.js`. No gastan nada.
- **Texto libre**: va a `/api/chat`, que llama a Gemini con las instrucciones de `instrucciones.mts`.
- **Revisión de webs**: si el visitante pega un enlace, la función lee esa página (`netlify/functions/chat/web.mts`) y le pasa al modelo una ficha con titular, botones, precios, contacto y demás, para que dé tres mejoras concretas.
- **Horóscopo web**: broma que acaba en un consejo real; está descrita en las instrucciones.
- **Tarjetas**: si el modelo recomienda un paquete, termina con una etiqueta como `[[paquete:web]]` y la web pinta la tarjeta.
- **«Sí, mándamelo»**: envía el correo y la conversación al formulario `resumen` de Netlify (Forms).
- **Límites**: 12 mensajes por conversación, 800 caracteres por mensaje, respuestas cortas y 10 peticiones por minuto por IP.

### Clave del modelo

La función habla con **Gemini** y necesita una clave guardada en Netlify:

1. Crea la clave en [Google AI Studio](https://aistudio.google.com/apikey).
2. En Netlify, proyecto → *Project configuration* → *Environment variables*, añade `GEMINI_API_KEY` con ámbito *Functions* y marcada como secreta.
3. Lanza un despliegue nuevo (*Deploys* → *Trigger deploy*): la clave no se aplica hasta entonces.

Sin clave, el chat sigue funcionando con las sugerencias y, al escribir texto libre, pide que te escriban por correo.

Abrir `/api/chat` en el navegador dice si la clave está activa (`"configurado": true`) sin enseñarla.

Los modelos se prueban en orden (`MODELS` en `index.mts`): si el primero está saturado, contesta el siguiente. `AICARLO_MODEL` permite poner otro delante.

Abrir `/api/chat?diagnostico=1` hace una llamada mínima y enseña qué responde cada modelo.

## Si cambias un precio

Los precios están en tres sitios y tienen que coincidir:

1. `public/index.html` (sección de paquetes)
2. `public/app.js` (`PACKS`)
3. `netlify/functions/chat/instrucciones.mts`

## Pendiente antes de lanzar

- [ ] Sustituir todo lo que está entre corchetes: imágenes y resultado de los casos
- [ ] Permiso de los clientes para aparecer como caso
- [ ] Correo real de contacto (`EMAIL` en `public/app.js`; ahora `carloby@gmail.com`)
- [ ] Enlaces reales de Instagram, LinkedIn y la tienda (o ocultar la sección de plantillas mientras esté vacía)
- [ ] Reescribir las respuestas de `CANNED` y los ejemplos de tono de `instrucciones.mts` con tu voz
- [ ] Redactar aviso legal y política de privacidad
- [ ] Activar Forms en Netlify y el aviso por correo de cada envío
- [ ] Tope de gasto del modelo y prueba del chat «a mala idea»
- [ ] Imagen para compartir (`og:image`)
- [ ] Quitar `<meta name="robots" content="noindex">` de `public/index.html`

## Probar en tu ordenador

```bash
npm install
npx netlify dev
```
