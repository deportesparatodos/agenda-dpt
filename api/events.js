import fetch from 'node-fetch';

// Imagen por defecto en caso de que un evento no tenga una.
const DEFAULT_IMAGE = 'https://i.ibb.co/dHPWxr8/depete.jpg';

/**
 * Obtiene y procesa los eventos desde la API de ppvs.su,
 * intentando a través de una lista de proxies hasta que uno funcione.
 * @returns {Promise<Array>} Una promesa que resuelve a un array de objetos de evento.
 */
async function fetchPpvsSuEvents() {
    const targetUrl = 'https://ppvs.su/api/streams';

    // --- INICIO DE LA MODIFICACIÓN: SISTEMA DE PROXIES REDUNDANTES ---
    // Lista de proxies a intentar en orden. Si uno falla, se intentará con el siguiente.
    // Se han añadido 16 proxies más para aumentar la fiabilidad.
    const proxies = [
        // Proxies originales
        'https://cors.sh/',
        'https://thingproxy.freeboard.io/fetch/',
        'https://api.allorigins.win/raw?url=',
        'https://corsproxy.io/?',
        // Nuevos proxies añadidos
        'https://api.codetabs.com/v1/proxy?quest=',
        'https://cors-anywhere.herokuapp.com/',
        'https://proxy.cors.sh/',
        'https://cors.zbe.ee/',
        'https://yacdn.org/proxy/',
        'https://caching-cors-anywhere.herokuapp.com/',
        'https://cors-bypass-server.herokuapp.com/',
        'https://pure-coast-24477.herokuapp.com/',
        'https://calm-hollows-39328.herokuapp.com/',
        'https://sheltered-tor-47358.herokuapp.com/',
        'https://evening-badlands-32343.herokuapp.com/',
        'https://fierce-retreat-76503.herokuapp.com/',
        'https://serene-hollows-97215.herokuapp.com/',
        'https://cors-proxy.fringe.zone/',
        'https://cors-server.herokuapp.com/',
        'https://pacific-caverns-96128.herokuapp.com/'
    ];

    for (const proxyUrl of proxies) {
        let url;
        const options = { timeout: 20000 }; // Timeout de 20 segundos por intento.

        // Ajusta la URL y las opciones según los requisitos de cada proxy.
        if (proxyUrl.includes('cors.sh')) {
            url = `${proxyUrl}${targetUrl}`;
            options.headers = { 'x-cors-api-key': 'temp_public_key' };
        } else if (proxyUrl.includes('allorigins.win')) {
            url = `${proxyUrl}${encodeURIComponent(targetUrl)}`;
        } else if (proxyUrl.includes('codetabs.com')) {
            url = `${proxyUrl}${targetUrl}`; // El parámetro 'quest=' ya está en la URL base.
        }
        else {
            url = `${proxyUrl}${targetUrl}`;
        }
        
        console.log(`Intentando obtener eventos a través del proxy: ${proxyUrl}`);
        
        try {
            const response = await fetch(url, options);

            // Si la respuesta no es exitosa, lanza un error para pasar al siguiente proxy.
            if (!response.ok) {
                throw new Error(`Proxy falló con estado ${response.status}`);
            }

            const data = await response.json();

            // Valida que la respuesta de la API sea la correcta y no un error del proxy.
            if (!data.success || !Array.isArray(data.streams)) {
                throw new Error('El proxy devolvió datos inesperados o incorrectos.');
            }

            // --- ¡ÉXITO! ---
            // Si llegamos aquí, el proxy funcionó y tenemos los datos correctos.
            console.log(`¡Éxito con el proxy: ${proxyUrl}! Procesando eventos...`);
            
            const allEvents = [];
            const nowInSeconds = Date.now() / 1000;

            data.streams.forEach(category => {
                if (category.streams && Array.isArray(category.streams)) {
                    category.streams.forEach(stream => {
                        if (!stream.iframe) return;

                        let status;
                        let time;
                        const startDate = new Date(stream.starts_at * 1000);

                        if (stream.always_live === 1) {
                            status = 'En vivo';
                            time = '24/7';
                        } else if (stream.starts_at && stream.ends_at) {
                            if (nowInSeconds >= stream.starts_at && nowInSeconds <= stream.ends_at) {
                                status = 'En vivo';
                                time = 'En vivo';
                            } else if (nowInSeconds < stream.starts_at) {
                                status = 'Próximamente';
                                time = startDate.toLocaleTimeString('es-AR', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    timeZone: 'America/Argentina/Buenos_Aires'
                                });
                            } else {
                                return; // Evento finalizado
                            }
                        } else {
                            return; // Evento sin datos de tiempo
                        }
                        
                        const event = {
                            title: stream.name || 'Evento sin título',
                            image: stream.poster || DEFAULT_IMAGE,
                            category: stream.category_name || 'Otros',
                            options: [stream.iframe],
                            buttons: [stream.tag || 'VER'],
                            time: time,
                            status: status,
                            date: startDate.toISOString().split('T')[0],
                            language: 'N/A',
                            source: 'ppvsu'
                        };
                        allEvents.push(event);
                    });
                }
            });

            console.log(`ppvs.su: ${allEvents.length} eventos procesados exitosamente.`);
            return allEvents; // Devuelve los eventos y termina la ejecución.

        } catch (error) {
            // Si un proxy falla, se registra el error y el bucle continúa con el siguiente.
            console.error(`Error con el proxy ${proxyUrl}: ${error.message}`);
        }
    }
    // --- FIN DE LA MODIFICACIÓN ---

    // Si el bucle termina, significa que todos los proxies fallaron.
    console.error('Todos los proxies fallaron. No se pudieron obtener los eventos.');
    return []; 
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
