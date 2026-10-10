// El cielo de hoy, calculado de verdad (posiciones astronómicas, no predicciones).
// AiCarlo lo usa en el horóscopo para culpar a los planetas con datos reales:
// en qué signo están el Sol y la Luna, la fase lunar y qué planetas están retrógrados.

import * as astronomia from "astronomy-engine";

// En Netlify la librería se carga como módulo CommonJS y sus funciones llegan dentro de "default";
// en otros entornos llegan sueltas. Así funciona en los dos.
const lib = ((astronomia as { default?: unknown }).default ?? astronomia) as typeof astronomia;
const { Body, Ecliptic, EclipticGeoMoon, GeoVector, MoonPhase, SunPosition } = lib;
type Body = astronomia.Body;

const SIGNOS = ["Aries", "Tauro", "Géminis", "Cáncer", "Leo", "Virgo", "Libra", "Escorpio", "Sagitario", "Capricornio", "Acuario", "Piscis"];

const PLANETAS: [Body, string][] = [
  [Body.Mercury, "Mercurio"],
  [Body.Venus, "Venus"],
  [Body.Mars, "Marte"],
  [Body.Jupiter, "Júpiter"],
  [Body.Saturn, "Saturno"],
  [Body.Uranus, "Urano"],
  [Body.Neptune, "Neptuno"],
  [Body.Pluto, "Plutón"],
];

const DIA = 86400000;
const MAX_DIAS = 200; // hasta dónde se busca el cambio de sentido de un planeta

const signo = (longitud: number) => SIGNOS[Math.floor((((longitud % 360) + 360) % 360) / 30)];

const fecha = (d: Date) =>
  new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", timeZone: "Europe/Madrid" }).format(d);

/** Longitud eclíptica de un planeta vista desde la Tierra, en grados. */
const longitud = (body: Body, d: Date) => Ecliptic(GeoVector(body, d, true)).elon;

/** Un planeta está retrógrado cuando, visto desde la Tierra, su longitud disminuye. */
function retrogrado(body: Body, d: Date): boolean {
  const avance = ((longitud(body, new Date(d.getTime() + DIA)) - longitud(body, d) + 540) % 360) - 180;
  return avance < 0;
}

/** Primer día, a partir de mañana, en que el planeta cambia de sentido. */
function cambio(body: Body, desde: Date, estado: boolean): Date | null {
  for (let i = 1; i <= MAX_DIAS; i += 1) {
    const d = new Date(desde.getTime() + i * DIA);
    if (retrogrado(body, d) === estado) continue;
    // Afina dentro de ese día para que la fecha no baile según la hora a la que se pregunte.
    let antes = d.getTime() - DIA;
    let despues = d.getTime();
    while (despues - antes > 3600000) {
      const medio = (antes + despues) / 2;
      if (retrogrado(body, new Date(medio)) === estado) antes = medio;
      else despues = medio;
    }
    // "retrogrado" compara con el día siguiente: el cambio real cae medio día después.
    return new Date(despues + DIA / 2);
  }
  return null;
}

function faseLunar(grados: number): string {
  const fases = ["luna nueva", "luna creciente", "cuarto creciente", "luna gibosa creciente", "luna llena", "luna gibosa menguante", "cuarto menguante", "luna menguante"];
  return fases[Math.round(grados / 45) % 8];
}

/** Resumen del cielo en texto, listo para pasárselo al modelo. */
export function cieloDeHoy(ahora: Date = new Date()): string {
  const lineas = [
    `Sol en ${signo(SunPosition(ahora).elon)}.`,
    `Luna en ${signo(EclipticGeoMoon(ahora).lon)}, ${faseLunar(MoonPhase(ahora))}.`,
  ];

  const retro: string[] = [];
  const directos: string[] = [];
  for (const [body, nombre] of PLANETAS) {
    const donde = `${nombre} en ${signo(longitud(body, ahora))}`;
    if (retrogrado(body, ahora)) {
      const fin = cambio(body, ahora, true);
      retro.push(fin ? `${donde} (hasta el ${fecha(fin)})` : donde);
    } else {
      directos.push(donde);
    }
  }
  lineas.push(retro.length ? `Planetas retrógrados ahora: ${retro.join("; ")}.` : "Ahora mismo no hay ningún planeta retrógrado.");
  lineas.push(`Planetas directos (NO retrógrados): ${directos.join("; ")}.`);

  if (!retrogrado(Body.Mercury, ahora)) {
    const inicio = cambio(Body.Mercury, ahora, false);
    if (inicio) lineas.push(`El próximo Mercurio retrógrado empieza el ${fecha(inicio)}.`);
  }
  return lineas.join("\n");
}
