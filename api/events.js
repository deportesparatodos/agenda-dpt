import fetch from 'node-fetch';

// Imagen por defecto en caso de que un evento no tenga una.
const DEFAULT_IMAGE = 'https://i.ibb.co/dHPWxr8/depete.jpg';

/**
 * Obtiene y procesa los eventos desde la API de ppvs.su.
 * @returns {Promise<Array>} Una promesa que resuelve a un array de objetos de evento.
 */
async function fetchPpvsSuEvents() {
    // --- INICIO DE LA MODIFICACIÓN ---
    // El proxy anterior (cors.sh) está devolviendo un error 404. Cambiamos a otro
    // proxy público (thingproxy.freeboard.io) para intentar solucionar el problema.
    const PROXY_URL = 'https://thingproxy.freeboard.io/fetch/';
    const targetUrl = 'https://ppvs.su/api/streams';
    const url = `${PROXY_URL}${targetUrl}`;
    
    console.log(`Obteniendo eventos desde ${targetUrl} a través del proxy thingproxy...`);
    
    try {
        // Se realiza la petición a través del nuevo proxy. Este no requiere cabeceras especiales.
        const response = await fetch(url, {
            timeout: 20000, // Aumentamos el timeout porque el proxy añade latencia.
        });

        // Si la respuesta no es exitosa, lanza un error.
        if (!response.ok) {
            const errorBody = await response.text();
            const errorDetails = errorBody.startsWith('<') ? 'Respuesta HTML (posiblemente del proxy o Cloudflare)' : errorBody;
            throw new Error(`Error HTTP ${response.status}: ${response.statusText}. Respuesta: ${errorDetails}`);
        }

        const data = await response.json();

        // Valida que la respuesta de la API sea exitosa y tenga el formato esperado.
        if (!data.success || !Array.isArray(data.streams)) {
            console.error('El formato de la respuesta de la API de ppvs.su no es el esperado o la petición no fue exitosa.');
            // Añadimos un log para ver qué datos se recibieron en caso de fallo de formato.
            console.log('Datos recibidos:', JSON.stringify(data, null, 2));
            return [];
        }

        const allEvents = [];
        const nowInSeconds = Date.now() / 1000; // Tiempo actual en segundos para comparar con los timestamps.

        // Itera sobre cada categoría de streams.
        data.streams.forEach(category => {
            if (category.streams && Array.isArray(category.streams)) {
                // Itera sobre cada stream dentro de la categoría.
                category.streams.forEach(stream => {
                    // Omite el evento si no tiene un enlace de iframe.
                    if (!stream.iframe) {
                        return;
                    }

                    let status;
                    let time;
                    const startDate = new Date(stream.starts_at * 1000);

                    // Lógica para determinar el estado del evento.
                    if (stream.always_live === 1) {
                        status = 'En vivo';
                        time = '24/7';
                    } else if (stream.starts_at && stream.ends_at) {
                         if (nowInSeconds >= stream.starts_at && nowInSeconds <= stream.ends_at) {
                            status = 'En vivo';
                            time = 'En vivo';
                        } else if (nowInSeconds < stream.starts_at) {
                            status = 'Próximamente';
                            // Formatea la hora de inicio para la zona horaria de Argentina.
                            time = startDate.toLocaleTimeString('es-AR', {
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: 'America/Argentina/Buenos_Aires'
                            });
                        } else {
                            // Si nowInSeconds > stream.ends_at, el evento ya finalizó y no se añade.
                            return;
                        }
                    } else {
                        // Si un evento no es 24/7 y no tiene timestamps, no se puede procesar.
                        return;
                    }
                    
                    // Construye el objeto del evento con el formato final.
                    const event = {
                        title: stream.name || 'Evento sin título',
                        image: stream.poster || DEFAULT_IMAGE,
                        category: stream.category_name || 'Otros',
                        options: [stream.iframe], // El enlace del iframe va en un array.
                        buttons: [stream.tag || 'VER'], // La etiqueta del stream (ej. "FOX") va como botón.
                        time: time,
                        status: status,
                        date: startDate.toISOString().split('T')[0],
                        language: 'N/A', // El idioma no es proporcionado por la API.
                        source: 'ppvsu'
                    };
                    allEvents.push(event);
                });
            }
        });

        console.log(`ppvs.su: ${allEvents.length} eventos procesados exitosamente.`);
        return allEvents;

    } catch (error) {
        console.error('Error al obtener eventos de ppvs.su:', error);
        return []; // Devuelve un array vacío en caso de error.
    }
}


// --- FUNCIÓN PRINCIPAL EXPORTADA (HANDLER DE VERCELL) ---
export default async (req, res) => {
    // Configura las cabeceras de CORS y caché.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    // Caché de 5 minutos en el CDN, con revalidación en segundo plano por 10 minutos.
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    // Maneja la petición pre-vuelo (preflight) OPTIONS de CORS.
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Solo permite peticiones GET.
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        console.log('Iniciando obtención de eventos de ppvs.su...');
        const events = await fetchPpvsSuEvents();

        if (events.length === 0) {
            console.warn('No se obtuvieron eventos de ppvs.su en esta ejecución.');
        }

        console.log(`Total de eventos a devolver: ${events.length}`);
        return res.status(200).json(events);

    } catch (error) {
        console.error('Error en la función principal (handler):', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};
